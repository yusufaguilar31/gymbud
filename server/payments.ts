import crypto from 'crypto';
import Stripe from 'stripe';
import { db } from './db.ts';
import { getSessionSecret } from './auth.ts';
import { SUBSCRIPTION_PLANS } from '../src/shared/constants.ts';

function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !key.startsWith('sk_')) return null;
  return new Stripe(key);
}

export function getPaymentGatewayStatus() {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const stripeConfigured = Boolean(stripeKey && stripeKey.startsWith('sk_'));
  return {
    stripe_configured: stripeConfigured,
    mode: stripeConfigured ? 'live_stripe' : 'tokenized_sandbox',
    supported_providers: ['Stripe (Global + UAE AED)', 'Tokenized Hosted Checkout (PCI-DSS SAQ-A)'],
    currency: 'AED',
  };
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): { valid: boolean; event?: any } {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (stripe && webhookSecret && signature) {
    try {
      const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      return { valid: true, event };
    } catch {
      return { valid: false };
    }
  }
  return { valid: false };
}

export function signInternalCheckoutToken(payload: Record<string, unknown>): string {
  const secret = getSessionSecret();
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${hmac}`;
}

export function verifyInternalCheckoutToken(token: string): Record<string, any> | null {
  const secret = getSessionSecret();
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export async function createCheckoutSession(params: {
  userId: string;
  email: string;
  planId: 'gymbud_plus_monthly' | 'gymbud_plus_annual';
  originUrl: string;
  idempotencyKey: string;
}) {
  const plan = SUBSCRIPTION_PLANS[params.planId];
  if (!plan) {
    throw new Error('Invalid subscription plan');
  }

  // Prevent duplicate charges using idempotency key
  const existingPayment = db
    .prepare(`SELECT id, receipt_number FROM payment_records WHERE idempotency_key = ?`)
    .get(params.idempotencyKey) as { id: string; receipt_number: string } | undefined;
  if (existingPayment) {
    return { duplicate: true, receipt_number: existingPayment.receipt_number };
  }

  const stripe = getStripeClient();
  if (stripe) {
    const priceId =
      params.planId === 'gymbud_plus_annual'
        ? process.env.STRIPE_PRICE_ANNUAL
        : process.env.STRIPE_PRICE_MONTHLY;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: params.email,
      metadata: {
        user_id: params.userId,
        plan_id: params.planId,
        idempotency_key: params.idempotencyKey,
      },
      line_items: priceId
        ? [{ price: priceId, quantity: 1 }]
        : [
            {
              price_data: {
                currency: 'aed',
                product_data: { name: plan.name, description: plan.renewalNote },
                unit_amount: plan.priceAed * 100,
                recurring: { interval: params.planId === 'gymbud_plus_annual' ? 'year' : 'month' },
              },
              quantity: 1,
            },
          ],
      success_url: `${params.originUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${params.originUrl}/?checkout=cancelled`,
    });

    return {
      mode: 'stripe_hosted' as const,
      checkout_url: session.url,
      session_id: session.id,
    };
  }

  // Tokenized provider-hosted style checkout intent (PCI-compliant: zero raw card numbers ever accepted by GYMBUD)
  const intentId = `pi_tok_${crypto.randomBytes(10).toString('hex')}`;
  const checkoutToken = signInternalCheckoutToken({
    intent_id: intentId,
    user_id: params.userId,
    plan_id: params.planId,
    amount_aed: plan.priceAed,
    idempotency_key: params.idempotencyKey,
    exp: Date.now() + 1000 * 60 * 15,
  });

  return {
    mode: 'tokenized_checkout' as const,
    intent_id: intentId,
    checkout_token: checkoutToken,
    amount_aed: plan.priceAed,
    currency: 'AED',
    plan_name: plan.name,
    renewal_note: plan.renewalNote,
  };
}

export function finalizeVerifiedSubscription(params: {
  userId: string;
  planId: 'gymbud_plus_monthly' | 'gymbud_plus_annual';
  provider: string;
  providerSubscriptionId: string;
  providerPaymentIntentId: string;
  idempotencyKey: string;
  cardBrand: string;
  cardLast4: string;
}) {
  const plan = SUBSCRIPTION_PLANS[params.planId];
  const now = new Date();
  const periodEnd = new Date(now);
  if (params.planId === 'gymbud_plus_annual') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  const subId = `sub_${crypto.randomBytes(8).toString('hex')}`;
  const payId = `pay_${crypto.randomBytes(8).toString('hex')}`;
  const receiptNumber = `GB-AED-${now.getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const tx = db.transaction(() => {
    // Supersede prior active subscriptions
    db.prepare(
      `UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status IN ('active', 'cancelled')`
    ).run(params.userId);

    db.prepare(
      `INSERT INTO subscriptions
       (id, user_id, plan_id, status, provider, provider_subscription_id, current_period_start, current_period_end, cancel_at_period_end)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, 0)`
    ).run(
      subId,
      params.userId,
      params.planId,
      params.provider,
      params.providerSubscriptionId,
      now.toISOString(),
      periodEnd.toISOString()
    );

    db.prepare(
      `INSERT INTO payment_records
       (id, user_id, subscription_id, amount_aed, currency, status, provider, provider_payment_intent_id, idempotency_key, receipt_number, card_brand, card_last4, description)
       VALUES (?, ?, ?, ?, 'AED', 'succeeded', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      payId,
      params.userId,
      subId,
      plan.priceAed,
      params.provider,
      params.providerPaymentIntentId,
      params.idempotencyKey,
      receiptNumber,
      params.cardBrand,
      params.cardLast4,
      `${plan.name} — UAE AED Subscription`
    );

    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, body_safe, link_view)
       VALUES (?, ?, 'billing', ?, ?, 'billing')`
    ).run(
      `ntf_${crypto.randomBytes(8).toString('hex')}`,
      params.userId,
      'GYMBUD+ Activated',
      `Your ${plan.name} subscription (${plan.priceAed} AED) is active. Receipt ${receiptNumber}.`
    );
  });

  tx();
  return { subscription_id: subId, payment_id: payId, receipt_number: receiptNumber };
}

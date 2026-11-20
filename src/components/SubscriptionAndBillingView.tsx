import { useCallback, useEffect, useState } from 'react';
import { Check, Clock, Lock, Receipt, Sparkles, Zap } from 'lucide-react';
import { api } from '../lib/api.ts';
import { SUBSCRIPTION_PLANS } from '../shared/constants.ts';
import type { CurrentUser, PaymentRecord, SubscriptionRecord } from '../shared/types.ts';

interface SubscriptionAndBillingViewProps {
  user: CurrentUser;
  onUpdated: (user: CurrentUser) => void;
}

export function SubscriptionAndBillingView({ user, onUpdated }: SubscriptionAndBillingViewProps) {
  const [selectedPlan, setSelectedPlan] = useState<'gymbud_plus_monthly' | 'gymbud_plus_annual'>('gymbud_plus_annual');
  const [confirmedRecurring, setConfirmedRecurring] = useState(false);

  const [comingSoon, setComingSoon] = useState(true);

  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(user.subscription);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBilling = useCallback(async () => {
    try {
      const res = await api<{
        coming_soon: boolean;
        is_plus: boolean;
        subscription: SubscriptionRecord | null;
        payments: PaymentRecord[];
      }>('/api/billing/overview');
      setComingSoon(res.coming_soon);
      setSubscription(res.subscription);
      setPayments(res.payments);
    } catch (err: any) {
      setError(err?.message || 'Unable to load subscription details.');
    }
  }, []);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  async function startCheckout() {
    setError(null);
    setMessage(null);
    if (!confirmedRecurring) {
      setError('Please confirm the recurring billing terms before proceeding.');
      return;
    }

    setLoading(true);
    try {
      const idempotencyKey = `idem_${user.id}_${selectedPlan}_${Math.floor(Date.now() / 5000)}`;
      const res = await api<any>('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({
          plan_id: selectedPlan,
          confirmed_recurring: true,
          idempotency_key: idempotencyKey,
        }),
      });

      if (res.mode === 'stripe_hosted' && res.checkout_url) {
        window.location.assign(res.checkout_url);
        return;
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to start checkout.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ user: CurrentUser }>('/api/billing/cancel', { method: 'POST' });
      onUpdated(res.user);
      setMessage('Subscription renewal cancelled transparently. Access continues until the end of your paid period.');
      loadBilling();
    } catch (err: any) {
      setError(err?.message || 'Unable to cancel subscription.');
    } finally {
      setLoading(false);
    }
  }

  async function handleBoost() {
    setError(null);
    try {
      const res = await api<{ boost_expires_at: string; user: CurrentUser }>('/api/billing/boost', { method: 'POST' });
      onUpdated(res.user);
      setMessage(
        `60-minute Profile Boost active until ${new Date(res.boost_expires_at).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}.`
      );
    } catch (err: any) {
      setError(err?.message || 'Unable to activate Profile Boost.');
    }
  }

  const plan = SUBSCRIPTION_PLANS[selectedPlan];
  const boostActive = Boolean(user.boost_expires_at && Date.parse(user.boost_expires_at) > Date.now());

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-white tracking-tight">
            GYMBUD+ {comingSoon && !subscription ? '· Coming Soon' : '& Billing'}
          </h1>
          <p className="text-sm text-zinc-400">
            All core matching, unlimited swipes, messaging, Workout DNA, and safety tools remain 100% free today.
          </p>
        </div>
        {comingSoon && !subscription && (
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#A3E635] shrink-0">
            <Clock className="w-4 h-4" />
            Launching Soon in UAE
          </div>
        )}
      </div>

      {message && (
        <div className="p-3.5 rounded-xl bg-[#A3E635]/10 border border-[#A3E635]/30 text-sm text-[#bef264]">
          {message}
        </div>
      )}
      {error && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Active Subscription Banner (when live Stripe subscription exists) */}
      {subscription && (
        <div className="border border-[#A3E635]/40 rounded-2xl bg-[#101214] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-[#A3E635] inline-flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" />
              Active GYMBUD+ Membership
            </div>
            <h2 className="text-xl font-bold text-white">
              {subscription.plan_id === 'gymbud_plus_annual'
                ? 'GYMBUD+ Annual (390 AED/yr)'
                : 'GYMBUD+ Monthly (49 AED/mo)'}
            </h2>
            <p className="text-xs text-zinc-400 font-mono-num">
              Status: {subscription.status.toUpperCase()} · Period ends{' '}
              {new Date(subscription.current_period_end).toLocaleDateString()}
              {subscription.cancel_at_period_end ? ' (Will not auto-renew)' : ''}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleBoost}
              className="min-h-[44px] px-4 rounded-lg bg-[#A3E635] text-[#070809] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#bef264] cursor-pointer"
            >
              <Zap className="w-4 h-4" />
              {boostActive ? 'Boost Active (Extend 60m)' : 'Activate 60m Profile Boost'}
            </button>
            {subscription.status === 'active' && !subscription.cancel_at_period_end && (
              <button
                type="button"
                disabled={loading}
                onClick={handleCancel}
                className="min-h-[44px] px-4 rounded-lg border border-white/15 text-xs font-medium text-zinc-300 hover:text-red-400 cursor-pointer"
              >
                Cancel Renewal
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Content: Coming Soon Preview & Waitlist OR Live Stripe Checkout */}
      {(!subscription || subscription.status !== 'active') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 border border-white/10 rounded-2xl bg-[#101214] p-6 space-y-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-2xl font-bold text-white">
                {comingSoon ? 'Planned GYMBUD+ Perks (Coming Soon)' : 'Everything Included in GYMBUD+'}
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-zinc-300">
              {[
                'See Who Likes You & match immediately',
                'Filter by specific favorite exercises',
                '6-Dimension Advanced Compatibility',
                '60-Minute Priority Profile Boost',
                'Travel Mode (Dubai, Riyadh, London, SG)',
                'Profile Visit Analytics & Custom Themes',
              ].map((item) => (
                <div key={item} className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-[#A3E635] shrink-0 mt-0.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <div className="border-t border-white/10 pt-4 text-xs text-zinc-400 space-y-1">
              <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-[#A3E635]" />
                Payment Security Commitment
              </div>
              <p>
                {comingSoon
                  ? 'GYMBUD+ billing is currently marked Coming Soon until live Stripe payment keys are connected. No card details are requested or collected today, and every core feature on GYMBUD is unlocked for free.'
                  : 'GYMBUD never collects or stores raw card numbers, CVVs, or PINs on its servers. Checkout runs securely via Stripe Hosted Checkout.'}
              </p>
            </div>
          </div>

          <div className="lg:col-span-5 border border-white/10 rounded-2xl bg-[#101214] p-6 space-y-5">
            <div>
              <div className="text-xs font-medium text-[#A3E635] mb-2">
                {comingSoon ? 'Planned UAE Pricing · Select Preferred Tier' : 'Choose Your Plan'}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedPlan('gymbud_plus_monthly')}
                  className={`p-3.5 rounded-xl border text-left cursor-pointer ${
                    selectedPlan === 'gymbud_plus_monthly'
                      ? 'border-[#A3E635] bg-[#A3E635]/10'
                      : 'border-white/10 bg-[#070809]'
                  }`}
                >
                  <div className="text-xs text-zinc-400">Monthly</div>
                  <div className="font-mono-num text-xl font-bold text-white mt-0.5">49 AED</div>
                  <div className="text-[11px] text-zinc-500">per month</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedPlan('gymbud_plus_annual')}
                  className={`p-3.5 rounded-xl border text-left cursor-pointer ${
                    selectedPlan === 'gymbud_plus_annual'
                      ? 'border-[#A3E635] bg-[#A3E635]/10'
                      : 'border-white/10 bg-[#070809]'
                  }`}
                >
                  <div className="text-xs text-[#A3E635] font-medium">Annual · Save 34%</div>
                  <div className="font-mono-num text-xl font-bold text-white mt-0.5">390 AED</div>
                  <div className="text-[11px] text-zinc-500">32.50 AED/mo eq.</div>
                </button>
              </div>
            </div>

            {comingSoon ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-[#070809] border border-white/10 text-xs text-zinc-300 space-y-1.5">
                  <div className="font-semibold text-white">Coming Soon</div>
                  <p className="text-zinc-400 leading-relaxed">
                    GYMBUD+ subscriptions are not open yet while payment integration is being finalized. Enjoy full unlimited access to Discover, Matches, Messages, Workout DNA, Community, and Safety Center for free.
                  </p>
                </div>

                <div className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#070809] text-zinc-400 text-sm font-medium inline-flex items-center justify-center gap-2">
                  <Clock className="w-4 h-4 text-[#A3E635]" />
                  Coming Soon ({plan.priceAed} AED / {plan.intervalLabel})
                </div>
              </div>
            ) : (
              <>
                <div className="p-3.5 rounded-xl bg-[#070809] border border-white/10 text-xs text-zinc-300 space-y-1">
                  <div className="flex justify-between font-semibold text-white">
                    <span>Total Due Today</span>
                    <span className="font-mono-num">{plan.priceAed} AED</span>
                  </div>
                  <p className="text-zinc-400">{plan.renewalNote}</p>
                </div>

                <label className="flex items-start gap-2.5 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmedRecurring}
                    onChange={(e) => setConfirmedRecurring(e.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-[#A3E635]"
                  />
                  <span>
                    I confirm the recurring {plan.priceAed} AED/{plan.intervalLabel} billing terms. No hidden fees; cancel anytime.
                  </span>
                </label>

                <button
                  type="button"
                  disabled={loading}
                  onClick={startCheckout}
                  className="w-full min-h-[46px] rounded-xl bg-[#A3E635] text-[#070809] text-sm font-semibold hover:bg-[#bef264] disabled:opacity-50 cursor-pointer"
                >
                  {loading ? 'Preparing Secure Checkout...' : `Continue to Stripe Checkout (${plan.priceAed} AED)`}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Payment History & Receipts */}
      {payments.length > 0 && (
        <div className="border border-white/10 rounded-2xl bg-[#101214] p-6 space-y-4">
          <h3 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <Receipt className="w-5 h-5 text-[#A3E635]" />
            Payment History &amp; Receipts
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-zinc-400">
                  <th className="py-2.5 pr-4">Receipt</th>
                  <th className="py-2.5 pr-4">Description</th>
                  <th className="py-2.5 pr-4">Method</th>
                  <th className="py-2.5 pr-4">Status</th>
                  <th className="py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {payments.map((pay) => (
                  <tr key={pay.id}>
                    <td className="py-3 pr-4 font-mono-num text-white">{pay.receipt_number}</td>
                    <td className="py-3 pr-4 text-zinc-300">{pay.description}</td>
                    <td className="py-3 pr-4 text-zinc-400">
                      {pay.card_brand} {pay.card_last4 ? `•••• ${pay.card_last4}` : ''}
                    </td>
                    <td className="py-3 pr-4 text-[#A3E635] capitalize">{pay.status}</td>
                    <td className="py-3 text-right font-mono-num text-white">
                      {pay.amount_aed} {pay.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Camera, Check, Copy, Dumbbell, Flag, Flame, MessageCircle, Plus, Search, Trash2 } from 'lucide-react';
import { api, fileToCompressedDataUrl } from '../lib/api.ts';
import type { CommunityPost, CurrentUser } from '../shared/types.ts';
import { ResilientImage } from './ResilientImage.tsx';

const CATEGORIES = ['All', 'Milestone', 'Workout Routine', 'Progress', 'Discussion'] as const;

interface CommunityViewProps {
  user: CurrentUser;
}

export function CommunityView({ user }: CommunityViewProps) {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [category, setCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedPostId, setCopiedPostId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showComposer, setShowComposer] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [postCat, setPostCat] = useState('Milestone');
  const [includeRoutine, setIncludeRoutine] = useState(false);
  const [routineName, setRoutineName] = useState('');
  const [routineLines, setRoutineLines] = useState('');
  const [imageData, setImageData] = useState('');

  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [reportingPost, setReportingPost] = useState<CommunityPost | null>(null);
  const [reportReason, setReportReason] = useState('Inappropriate or off-topic content');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = category !== 'All' ? `?category=${encodeURIComponent(category)}` : '';
      const res = await api<{ posts: CommunityPost[] }>(`/api/community/posts${q}`);
      setPosts(res.posts);
    } catch (err: any) {
      setError(err?.message || 'Unable to load community posts.');
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  async function handleCreatePost(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const routine =
        includeRoutine && routineName.trim()
          ? {
              name: routineName.trim(),
              exercises: routineLines
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .map((line) => ({ name: line, sets: '3–4', reps: '8–12' })),
            }
          : null;

      await api('/api/community/posts', {
        method: 'POST',
        body: JSON.stringify({
          title,
          body,
          category: postCat,
          routine,
          image_data: imageData || undefined,
        }),
      });
      setTitle('');
      setBody('');
      setRoutineName('');
      setRoutineLines('');
      setImageData('');
      setIncludeRoutine(false);
      setShowComposer(false);
      setFeedback('Post published to the GYMBUD community.');
      loadPosts();
    } catch (err: any) {
      setError(err?.message || 'Unable to publish post.');
    }
  }

  async function handleReact(postId: string) {
    setError(null);
    try {
      await api(`/api/community/posts/${postId}/react`, { method: 'POST' });
      loadPosts();
    } catch (err: any) {
      setError(err?.message || 'Unable to update reaction.');
    }
  }

  async function handleComment(postId: string, e: React.FormEvent) {
    e.preventDefault();
    const content = (commentDrafts[postId] || '').trim();
    if (!content) return;
    setError(null);
    try {
      await api(`/api/community/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      setCommentDrafts((prev) => ({ ...prev, [postId]: '' }));
      loadPosts();
    } catch (err: any) {
      setError(err?.message || 'Unable to add comment.');
    }
  }

  async function handleDeletePost(postId: string) {
    setError(null);
    try {
      await api(`/api/community/posts/${postId}`, { method: 'DELETE' });
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      setFeedback('Post removed.');
    } catch (err: any) {
      setError(err?.message || 'Unable to delete post.');
    }
  }

  async function handleReportPost(e: React.FormEvent) {
    e.preventDefault();
    if (!reportingPost) return;
    setError(null);
    try {
      await api('/api/safety/report', {
        method: 'POST',
        body: JSON.stringify({
          target_user_id: reportingPost.user_id,
          target_type: 'post',
          target_id: reportingPost.id,
          reason: reportReason,
        }),
      });
      setReportingPost(null);
      setFeedback('Post reported to GYMBUD moderators.');
    } catch (err: any) {
      setError(err?.message || 'Unable to submit report.');
    }
  }

  async function handleCopyRoutine(post: CommunityPost) {
    if (!post.routine) return;
    const text = [
      post.routine.name,
      ...post.routine.exercises.map((ex) => `- ${ex.name} (${ex.sets} × ${ex.reps})`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPostId(post.id);
      window.setTimeout(() => setCopiedPostId(null), 2000);
    } catch {
      setFeedback('Copy to clipboard is blocked in this browser frame.');
    }
  }

  const visiblePosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q) ||
        p.author_name.toLowerCase().includes(q) ||
        p.author_city.toLowerCase().includes(q)
    );
  }, [posts, searchQuery]);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-white tracking-tight">Gym Community</h1>
          <p className="text-sm text-zinc-400">
            Share workout milestones, routines, and training discussions across the UAE
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowComposer(!showComposer)}
          className="min-h-[44px] px-5 rounded-xl bg-[#A3E635] text-[#070809] text-sm font-semibold inline-flex items-center gap-2 hover:bg-[#bef264] cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          Share Post
        </button>
      </div>

      {/* Category Tabs + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`min-h-[38px] px-3.5 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                category === cat ? 'bg-[#A3E635] text-[#070809]' : 'bg-[#101214] text-zinc-400 border border-white/10 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative sm:w-60 shrink-0">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search posts or cities..."
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-[#101214] border border-white/15 text-xs text-white placeholder:text-zinc-500"
          />
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          {error}
        </div>
      )}

      {feedback && (
        <div className="p-3 rounded-lg bg-[#A3E635]/10 border border-[#A3E635]/30 text-sm text-[#bef264]">
          {feedback}
        </div>
      )}

      {showComposer && (
        <form onSubmit={handleCreatePost} className="border border-white/15 rounded-2xl bg-[#101214] p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs text-zinc-400 mb-1">Headline</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Hit a clean 100kg Bench Press at Train Al Reem"
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Category</label>
              <select
                value={postCat}
                onChange={(e) => setPostCat(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
              >
                <option value="Milestone">Milestone</option>
                <option value="Workout Routine">Workout Routine</option>
                <option value="Progress">Progress</option>
                <option value="Discussion">Discussion</option>
              </select>
            </div>
          </div>

          <textarea
            rows={3}
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share your workout notes, lessons learned, or open discussion..."
            className="w-full p-3.5 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
          />

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="inline-flex items-center gap-2 text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeRoutine}
                onChange={(e) => setIncludeRoutine(e.target.checked)}
                className="w-4 h-4 accent-[#A3E635]"
              />
              Attach workout routine
            </label>

            <label className="inline-flex items-center gap-1.5 text-[#A3E635] cursor-pointer">
              <Camera className="w-4 h-4" />
              {imageData ? 'Photo attached' : 'Attach progress photo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setImageData(await fileToCompressedDataUrl(f));
                }}
              />
            </label>
          </div>

          {includeRoutine && (
            <div className="p-4 rounded-xl bg-[#070809] border border-white/10 space-y-2.5">
              <input
                type="text"
                value={routineName}
                onChange={(e) => setRoutineName(e.target.value)}
                placeholder="Routine Title (e.g. Push Day Hypertrophy)"
                className="w-full h-10 px-3 rounded-lg bg-[#101214] border border-white/15 text-sm text-white"
              />
              <textarea
                rows={3}
                value={routineLines}
                onChange={(e) => setRoutineLines(e.target.value)}
                placeholder="One exercise per line..."
                className="w-full p-3 rounded-lg bg-[#101214] border border-white/15 text-xs text-white font-mono-num"
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowComposer(false)} className="px-4 py-2 text-xs text-zinc-400 cursor-pointer">
              Cancel
            </button>
            <button type="submit" className="px-5 py-2.5 rounded-lg bg-[#A3E635] text-[#070809] text-xs font-semibold cursor-pointer">
              Publish to Community
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="h-48 rounded-2xl border border-white/10 bg-[#101214] animate-pulse" />
      ) : visiblePosts.length === 0 ? (
        <div className="border border-white/10 rounded-2xl bg-[#101214] p-10 text-center space-y-3">
          <h3 className="text-lg font-semibold text-white">
            {searchQuery ? 'No posts matched your search' : 'No community posts yet'}
          </h3>
          <p className="text-sm text-zinc-400 max-w-md mx-auto">
            {searchQuery
              ? 'Try clearing your keyword filter or switching categories.'
              : 'Share the first training milestone, workout routine, or gym discussion with members across the UAE.'}
          </p>
          {!searchQuery && (
            <button
              type="button"
              onClick={() => setShowComposer(true)}
              className="min-h-[42px] px-5 rounded-lg bg-[#A3E635] text-[#070809] text-xs font-semibold hover:bg-[#bef264] cursor-pointer"
            >
              Share First Post
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {visiblePosts.map((post) => {
            const canDelete = post.user_id === user.id || user.role !== 'member';
            return (
            <article key={post.id} className="border border-white/10 rounded-2xl bg-[#101214] overflow-hidden">
              <div className="p-5 sm:p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl overflow-hidden border border-white/10 shrink-0">
                      <ResilientImage src={post.author_avatar} alt={post.author_name} className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-white">{post.author_name}</span>
                        {post.author_verified && <BadgeCheck className="w-4 h-4 text-[#A3E635]" />}
                      </div>
                      <div className="text-xs text-zinc-400">
                        {post.author_city} · {post.category}
                        {post.author_archetype ? ` · ${post.author_archetype}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDeletePost(post.id)}
                        aria-label="Delete post"
                        title="Delete post"
                        className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setReportingPost(post)}
                      aria-label="Report post"
                      className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 cursor-pointer"
                    >
                      <Flag className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <h2 className="text-lg font-bold text-white">{post.title}</h2>
                  <p className="mt-2 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{post.body}</p>
                </div>

                {post.routine && (
                  <div className="border border-white/10 rounded-xl p-4 bg-[#070809]">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-xs font-semibold text-[#A3E635] flex items-center gap-1.5">
                        <Dumbbell className="w-3.5 h-3.5" />
                        {post.routine.name}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyRoutine(post)}
                        className="text-[11px] font-medium text-zinc-400 hover:text-white inline-flex items-center gap-1 cursor-pointer"
                      >
                        {copiedPostId === post.id ? (
                          <>
                            <Check className="w-3 h-3 text-[#A3E635]" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy Routine
                          </>
                        )}
                      </button>
                    </div>
                    <div className="space-y-1 text-xs font-mono-num text-zinc-300">
                      {post.routine.exercises.map((ex, i) => (
                        <div key={i} className="flex justify-between">
                          <span>{ex.name}</span>
                          <span className="text-zinc-400">{ex.sets} × {ex.reps}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {post.image_url && (
                  <div className="aspect-[16/9] rounded-xl overflow-hidden border border-white/10 bg-[#070809]">
                    <ResilientImage src={post.image_url} alt={post.title} className="w-full h-full object-cover" />
                  </div>
                )}

                <div className="pt-2 border-t border-white/10 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => handleReact(post.id)}
                    className={`min-h-[38px] px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer ${
                      post.user_reacted ? 'bg-[#A3E635]/15 text-[#A3E635]' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    <Flame className="w-4 h-4" />
                    <span className="font-mono-num">{post.reaction_count}</span> Respect
                  </button>
                  <span className="text-xs text-zinc-400 inline-flex items-center gap-1.5">
                    <MessageCircle className="w-4 h-4" />
                    <span className="font-mono-num">{post.comment_count}</span> Comments
                  </span>
                </div>

                {/* Comments */}
                {post.comments.length > 0 && (
                  <div className="space-y-2.5 pt-2 border-t border-white/5">
                    {post.comments.map((c) => (
                      <div key={c.id} className="flex items-start gap-2.5 text-xs">
                        <div className="w-7 h-7 rounded-lg overflow-hidden shrink-0">
                          <ResilientImage src={c.author_avatar} alt={c.author_name} className="w-full h-full object-cover" />
                        </div>
                        <div className="bg-[#070809] border border-white/10 rounded-xl px-3 py-2 flex-1">
                          <span className="font-semibold text-white">{c.author_name}</span>{' '}
                          <span className="text-zinc-300">{c.content}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={(e) => handleComment(post.id, e)} className="flex gap-2">
                  <input
                    type="text"
                    value={commentDrafts[post.id] || ''}
                    onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))}
                    placeholder="Add supportive comment or ask about form..."
                    className="flex-1 h-10 px-3.5 rounded-lg bg-[#070809] border border-white/15 text-xs text-white"
                  />
                  <button
                    type="submit"
                    className="min-h-[40px] px-4 rounded-lg border border-white/15 text-xs font-medium text-white hover:bg-white/5 cursor-pointer"
                  >
                    Reply
                  </button>
                </form>
              </div>
            </article>
            );
          })}
        </div>
      )}

      {reportingPost && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form onSubmit={handleReportPost} className="w-full max-w-md border border-white/15 rounded-2xl bg-[#101214] p-6 space-y-4">
            <h3 className="font-display text-2xl font-bold text-white">Report Community Post</h3>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
            >
              <option>Inappropriate or off-topic content</option>
              <option>Harassment or disrespectful comment</option>
              <option>Spam or unauthorized solicitation</option>
              <option>Dangerous medical or steroid promotion</option>
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReportingPost(null)} className="px-4 py-2 text-xs text-zinc-400 cursor-pointer">
                Cancel
              </button>
              <button type="submit" className="px-5 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold cursor-pointer">
                Submit Report
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

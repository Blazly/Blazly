import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon.jsx";
import {
  COMMUNITY_CATEGORIES,
  addComment,
  createPost,
  deleteComment,
  deletePost,
  getPost,
  listPosts,
  voteComment,
  votePost,
} from "./communityClient.js";

const CATEGORY_LABEL = Object.fromEntries(COMMUNITY_CATEGORIES.map((c) => [c.id, c.label]));

function timeAgo(iso) {
  if (!iso) return "just now";
  const seconds = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const steps = [
    [60, "s"],
    [60, "m"],
    [24, "h"],
    [30, "d"],
    [12, "mo"],
  ];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (value < size) return `${value}${unit} ago`;
    value = Math.floor(value / size);
  }
  return `${value}y ago`;
}

function Avatar({ name, src }) {
  return src ? (
    <img className="disc-avatar" src={src} alt="" />
  ) : (
    <span className="disc-avatar" aria-hidden="true">
      {(name || "?").charAt(0).toUpperCase()}
    </span>
  );
}

function VoteButton({ voted, count, onVote, vertical }) {
  return (
    <button
      type="button"
      className={`disc-vote${voted ? " is-voted" : ""}${vertical ? " is-vertical" : ""}`}
      aria-pressed={voted}
      aria-label={voted ? "Remove upvote" : "Upvote"}
      onClick={(event) => {
        event.stopPropagation();
        onVote();
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="M12 5l7 8h-4.5v6h-5v-6H5z" fill={voted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
      <span>{count}</span>
    </button>
  );
}

function NewPostForm({ onCancel, onCreated }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("question");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await createPost({ title, body, category });
      onCreated(id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="disc-card disc-new" onSubmit={submit}>
      <h2>Start a discussion</h2>
      <div className="disc-chips" role="radiogroup" aria-label="Category">
        {COMMUNITY_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={category === c.id}
            className={`disc-chip${category === c.id ? " is-active" : ""}`}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <input
        className="disc-input"
        placeholder="Title, e.g. How do I get my brand cited in ChatGPT answers?"
        value={title}
        maxLength={160}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />
      <textarea
        className="disc-input disc-textarea"
        placeholder="Add details: what you tried, your site, what you expected…"
        value={body}
        maxLength={8000}
        rows={6}
        onChange={(e) => setBody(e.target.value)}
      />
      {error && <p className="disc-error">{error}</p>}
      <div className="disc-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-accent" disabled={busy || title.trim().length < 8}>
          {busy ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}

function PostDetail({ id, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => getPost(id).then(setData).catch((err) => setError(err.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function togglePostVote() {
    const result = await votePost(id).catch(() => null);
    if (result) setData((d) => ({ ...d, post: { ...d.post, ...result } }));
  }

  async function toggleCommentVote(commentId) {
    const result = await voteComment(id, commentId).catch(() => null);
    if (result) setData((d) => ({ ...d, comments: d.comments.map((c) => (c.id === commentId ? { ...c, ...result } : c)) }));
  }

  async function submitComment(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await addComment(id, comment);
      setComment("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <p className="disc-error">{error}</p>;
  if (!data) return <p className="disc-muted">Loading…</p>;
  const { post, comments } = data;

  return (
    <div className="disc-detail">
      <button type="button" className="btn btn-ghost disc-back" onClick={onBack}>
        ← All discussions
      </button>
      <article className="disc-card disc-post-full">
        <VoteButton vertical voted={post.voted} count={post.upvotes} onVote={togglePostVote} />
        <div className="disc-post-main">
          <div className="disc-meta">
            <span className={`disc-tag is-${post.category}`}>{CATEGORY_LABEL[post.category] || "Question"}</span>
            <Avatar name={post.authorName} src={post.authorAvatar} />
            <span>{post.authorName}</span>
            <span>·</span>
            <span>{timeAgo(post.createdAt)}</span>
          </div>
          <h1>{post.title}</h1>
          {post.body && <p className="disc-body">{post.body}</p>}
          {post.mine && (
            <button
              type="button"
              className="disc-link-danger"
              onClick={async () => {
                if (!window.confirm("Delete this post and all its comments?")) return;
                await deletePost(id);
                onBack(true);
              }}
            >
              Delete post
            </button>
          )}
        </div>
      </article>

      <h2 className="disc-comments-title">
        {comments.length} {comments.length === 1 ? "comment" : "comments"}
      </h2>

      <form className="disc-card disc-comment-form" onSubmit={submitComment}>
        <textarea
          className="disc-input disc-textarea"
          placeholder="Share an answer or ask a follow-up…"
          rows={3}
          maxLength={4000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        {error && <p className="disc-error">{error}</p>}
        <div className="disc-actions">
          <button type="submit" className="btn btn-accent" disabled={busy || comment.trim().length < 2}>
            {busy ? "Posting…" : "Comment"}
          </button>
        </div>
      </form>

      <ul className="disc-comments">
        {comments.map((c) => (
          <li key={c.id} className="disc-comment">
            <Avatar name={c.authorName} src={c.authorAvatar} />
            <div className="disc-comment-main">
              <div className="disc-meta">
                <strong>{c.authorName}</strong>
                {c.isAuthor && <span className="disc-op">Author</span>}
                <span>·</span>
                <span>{timeAgo(c.createdAt)}</span>
              </div>
              <p className="disc-body">{c.body}</p>
              <div className="disc-comment-actions">
                <VoteButton voted={c.voted} count={c.upvotes} onVote={() => toggleCommentVote(c.id)} />
                {c.mine && (
                  <button
                    type="button"
                    className="disc-link-danger"
                    onClick={async () => {
                      await deleteComment(id, c.id);
                      load();
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DiscussionsView() {
  const [posts, setPosts] = useState(null);
  const [sort, setSort] = useState("top");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    listPosts({ sort, category, q: query }).then(setPosts).catch((err) => setError(err.message));
  }, [sort, category, query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  async function toggleVote(id) {
    const result = await votePost(id).catch(() => null);
    if (result) setPosts((list) => list.map((p) => (p.id === id ? { ...p, ...result } : p)));
  }

  if (openId) {
    return (
      <div className="page disc-page">
        <PostDetail
          id={openId}
          onBack={() => {
            setOpenId(null);
            load();
          }}
        />
      </div>
    );
  }

  return (
    <div className="page disc-page">
      <header className="disc-hero">
        <div>
          <h1>Community discussions</h1>
          <p>Ask questions, share wins and learn from other Blazly users.</p>
        </div>
        {!composing && (
          <button type="button" className="btn btn-accent" onClick={() => setComposing(true)}>
            <Icon name="plus" size={15} /> New post
          </button>
        )}
      </header>

      {composing && (
        <NewPostForm
          onCancel={() => setComposing(false)}
          onCreated={(id) => {
            setComposing(false);
            setOpenId(id);
          }}
        />
      )}

      <div className="disc-toolbar">
        <div className="disc-tabs" role="tablist">
          {[
            ["top", "Top"],
            ["new", "New"],
          ].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={sort === id} className={sort === id ? "is-active" : ""} onClick={() => setSort(id)}>
              {label}
            </button>
          ))}
        </div>
        <label className="disc-search">
          <Icon name="search" size={15} />
          <input placeholder="Search discussions" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      <div className="disc-chips">
        <button type="button" className={`disc-chip${!category ? " is-active" : ""}`} onClick={() => setCategory("")}>
          All
        </button>
        {COMMUNITY_CATEGORIES.map((c) => (
          <button key={c.id} type="button" className={`disc-chip${category === c.id ? " is-active" : ""}`} onClick={() => setCategory(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      {error && <p className="disc-error">{error}</p>}
      {!posts && !error && <p className="disc-muted">Loading discussions…</p>}
      {posts && posts.length === 0 && (
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            <Icon name="messages" size={20} />
          </span>
          <p className="empty-title">{query || category ? "No matching discussions" : "No discussions yet"}</p>
          <p className="empty-text">Be the first to ask a question or share what's working for you.</p>
          <button type="button" className="btn btn-secondary empty-action" onClick={() => setComposing(true)}>
            Start a discussion
          </button>
        </div>
      )}

      <ul className="disc-list">
        {posts?.map((post) => (
          <li key={post.id}>
            <article
              className="disc-card disc-post"
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(post.id)}
              onKeyDown={(e) => e.key === "Enter" && setOpenId(post.id)}
            >
              <VoteButton vertical voted={post.voted} count={post.upvotes} onVote={() => toggleVote(post.id)} />
              <div className="disc-post-main">
                <div className="disc-meta">
                  <span className={`disc-tag is-${post.category}`}>{CATEGORY_LABEL[post.category] || "Question"}</span>
                  <Avatar name={post.authorName} src={post.authorAvatar} />
                  <span>{post.authorName}</span>
                  <span>·</span>
                  <span>{timeAgo(post.createdAt)}</span>
                </div>
                <h3>{post.title}</h3>
                {post.body && <p className="disc-excerpt">{post.body}</p>}
                <span className="disc-count">
                  <Icon name="messages" size={14} /> {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
                </span>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}

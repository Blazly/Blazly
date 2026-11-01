async function call(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export const COMMUNITY_CATEGORIES = [
  { id: "question", label: "Question" },
  { id: "seo", label: "SEO" },
  { id: "content", label: "Content" },
  { id: "ai-visibility", label: "AI visibility" },
  { id: "feature-request", label: "Feature request" },
  { id: "show-and-tell", label: "Show & tell" },
];

export function listPosts({ sort = "new", category = "", q = "" }) {
  const qs = new URLSearchParams({ sort, ...(category ? { category } : {}), ...(q ? { q } : {}) });
  return call("GET", `/api/community/posts?${qs}`).then((d) => d.posts);
}

export const getPost = (id) => call("GET", `/api/community/posts/${id}`);
export const createPost = (post) => call("POST", "/api/community/posts", post);
export const votePost = (id) => call("POST", `/api/community/posts/${id}/vote`, {});
export const deletePost = (id) => call("POST", `/api/community/posts/${id}/delete`, {});
export const addComment = (id, body) => call("POST", `/api/community/posts/${id}/comments`, { body });
export const voteComment = (id, commentId) => call("POST", `/api/community/posts/${id}/comment-vote`, { commentId });
export const deleteComment = (id, commentId) => call("POST", `/api/community/posts/${id}/comment-delete`, { commentId });

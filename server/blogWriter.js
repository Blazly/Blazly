import { readJson as sharedReadJson } from "./readJson.js";
/** Lazy-load pipeline so Vite config reload does not pull Genkit/jiti until first request. */
let pipelinePromise;

function getPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = import("./blogWriterPipeline.js");
  }
  return pipelinePromise;
}

export function attachBlogWriter(server) {
  server.middlewares.use(async (req, res, next) => {
    const [path, query = ""] = (req.url || "").split("?");
    if (path !== "/api/blog-writer") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const stream = new URLSearchParams(query).get("stream") === "1";
    try {
      const {
        formatBlogWriterReply,
        parseBlogWriterBrief,
        runBlogWriterPipeline,
        runBlogWriterRewrite,
      } = await getPipeline();
      const body = await readJson(req);
      if (stream) {
        await streamBlogWriter(body, res, {
          formatBlogWriterReply,
          parseBlogWriterBrief,
          runBlogWriterPipeline,
          runBlogWriterRewrite,
        });
        return;
      }
      const result = body.rewritePrompt
        ? await runBlogWriterRewrite(
            {
              rewritePrompt: body.rewritePrompt,
              previousArticle: body.previousArticle,
              effortAuto: body.effortAuto,
              effortTier: body.effortTier,
              brandName: body.brandName,
            },
            () => {},
          )
        : await runBlogWriterPipeline(
            parseBlogWriterBrief(body.message, {
              knowledge: body.knowledge,
              website: body.website,
              brandName: body.brandName,
              effortAuto: body.effortAuto,
              effortTier: body.effortTier,
              writerMode: body.writerMode,
            }),
            () => {},
          );
      sendJson(res, 200, { content: formatBlogWriterReply(result), result });
    } catch (error) {
      if (stream) {
        writeSse(res, { type: "error", error: error.message || "Blog generation failed." });
        res.end();
        return;
      }
      sendJson(res, 500, { error: error.message || "Blog generation failed." });
    }
  });
}

async function streamBlogWriter(
  body,
  res,
  { formatBlogWriterReply, parseBlogWriterBrief, runBlogWriterPipeline, runBlogWriterRewrite },
) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const emit = (payload) => writeSse(res, payload);

  try {
    const result = body.rewritePrompt
      ? await runBlogWriterRewrite(
          {
            rewritePrompt: body.rewritePrompt,
            previousArticle: body.previousArticle,
            effortAuto: body.effortAuto,
            effortTier: body.effortTier,
            brandName: body.brandName,
          },
          emit,
        )
      : await runBlogWriterPipeline(
          parseBlogWriterBrief(body.message, {
            knowledge: body.knowledge,
            website: body.website,
            brandName: body.brandName,
            effortAuto: body.effortAuto,
            effortTier: body.effortTier,
            writerMode: body.writerMode,
          }),
          emit,
        );
    const content = formatBlogWriterReply(result);
    emit({ type: "complete", content, result });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    emit({ type: "error", error: error.message || "Blog generation failed." });
    res.end();
  }
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function readJson(req) {
  return sharedReadJson(req, { maxBytes: 3_000_000 });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

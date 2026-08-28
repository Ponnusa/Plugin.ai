import json

from anthropic import Anthropic, APIConnectionError, APIStatusError, RateLimitError
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="Beacon AI Backend")

# Permissive for local dev. Tighten before any real deployment (§7 open question:
# auth/rate-limiting is explicitly deferred, not yet decided).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Anthropic()  # resolves ANTHROPIC_API_KEY from the environment

MODEL = "claude-sonnet-4-6"  # testing; swap back to claude-opus-5 or claude-sonnet-5 later if needed
MAX_RESPONSE_TOKENS = 4096  # 1024 was too tight for genuine "read this whole page" requests on long articles
MAX_PAGE_TEXT_CHARS = 20000  # simple truncation for v1; real chunking is a later backend concern

SYSTEM_PROMPT = (
    "You are Beacon AI, a voice assistant that helps blind and low-vision users "
    "understand webpages by voice. You will be given the extracted text of a webpage "
    "and a spoken request from the user (read the page, summarize it, translate it, "
    "or answer a question about it). For questions about what the page says, respond "
    "only using the page content provided — never invent facts that aren't in it, and "
    "if the page doesn't contain enough information to answer, say so plainly rather "
    "than guessing. The one exception is defining a word or phrase: use your general "
    "knowledge for the definition itself, and only lean on the page for context on how "
    "the term is being used there, if relevant. Your response will "
    "be read aloud by text-to-speech, so keep it concise and conversational — a few "
    "sentences for most requests, longer only for an explicit full read-aloud request. "
    "Do not use markdown, bullet points, or formatting — plain spoken sentences only. "
    "When asked for key points, main points, or a numbered list, speak them as a "
    "numbered spoken sequence — 'First, ... Second, ... Third, ...' — one short, "
    "self-contained sentence per point, still with no markdown symbols. "
    "Always report the BCP-47 language code of the language your response text is "
    "actually written in (e.g. 'en', 'ta', 'es', 'fr', 'hi') — this drives which voice "
    "reads it aloud, so if the user asked for a translation, this must be the "
    "translated language's code, not the original page's language."
)

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "response": {"type": "string"},
        "language": {
            "type": "string",
            "description": "BCP-47 language code matching the language `response` is written in.",
        },
    },
    "required": ["response", "language"],
    "additionalProperties": False,
}


class QueryRequest(BaseModel):
    pageTitle: str = ""
    pageText: str
    query: str


class QueryResponse(BaseModel):
    response: str
    language: str = "en"


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/query", response_model=QueryResponse)
def query(req: QueryRequest):
    # Page content is its own content block with a cache breakpoint, separate
    # from the query — repeated questions about the same page (same title +
    # text, byte-for-byte) hit Claude's prompt cache instead of paying full
    # input-token cost and latency for the same content every time. The query
    # block comes after the breakpoint since it varies on every request.
    page_block = {
        "type": "text",
        "text": f"Page title: {req.pageTitle}\n\nPage content:\n{req.pageText[:MAX_PAGE_TEXT_CHARS]}",
        "cache_control": {"type": "ephemeral", "ttl": "1h"},
    }
    query_block = {"type": "text", "text": f"User request: {req.query}"}

    try:
        message = client.messages.create(
            model=MODEL,
            max_tokens=MAX_RESPONSE_TOKENS,
            system=SYSTEM_PROMPT,
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": RESPONSE_SCHEMA},
            },
            messages=[{"role": "user", "content": [page_block, query_block]}],
        )
        print(
            f"[cache] read={message.usage.cache_read_input_tokens} "
            f"created={message.usage.cache_creation_input_tokens} "
            f"uncached={message.usage.input_tokens}"
        )
    except RateLimitError:
        return QueryResponse(
            response="I'm getting too many requests right now. Please try again in a moment."
        )
    except APIConnectionError:
        return QueryResponse(
            response="I couldn't reach the AI service. Please check your connection and try again."
        )
    except APIStatusError:
        return QueryResponse(
            response="Something went wrong on my end. Please try again."
        )

    text = next((b.text for b in message.content if b.type == "text"), None)
    if not text:
        return QueryResponse(response="I couldn't come up with a response for that.")

    try:
        data = json.loads(text)
        return QueryResponse(response=data["response"].strip(), language=data.get("language") or "en")
    except (json.JSONDecodeError, KeyError):
        return QueryResponse(response=text.strip())

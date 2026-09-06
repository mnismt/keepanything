# KeepAnything Product Brief

Keep anything. We'll figure out the rest.

KeepAnything is a local-first desktop application: a personal library where users can throw almost anything
(files, folders, screenshots, documents, links, GitHub repositories, videos, images, PDFs...) without deciding where it
belongs. No manual folder hierarchies, tags, renaming or organisation decisions. An AI reasoning agent sits at the
intake layer:

    user captures something → KeepAnything preserves the original → AI understands what it is → AI understands why it
    might matter → AI finds relationships to existing items → AI creates semantic organisation → library becomes more
    useful over time

The product should feel like a native utility that happens to be intelligent. NOT a generic AI application: no giant
chatbot dominating the interface, no excessive gradients, no glowing AI icons, no "Ask AI ✨" everywhere. Most
intelligence is ambient and automatic.

## 1. Product goal
Humans recognise things worth keeping but are bad at stopping to organise them. Normal software asks: what folder,
filename, tags, collection? KeepAnything removes those decisions: see something useful → drag it → drop it → continue
working. Everything after that is automatic. Over time it becomes a semantic memory layer; retrieval works the way
humans remember: "that open-source macOS app I saved a few weeks ago", "the website with the globe animation",
"something I saved about cheap inference providers", "show me everything that influenced the mnismt website".

## 2. Hackathon context (MiniMax Week, Reasoning track)
The AI must not merely do input → classification → tags. The reasoning component must visibly perform useful multi-step
decisions: inspect incoming items, understand them, compare with the existing library, determine relationships, decide
whether collections/themes should be created, and perform multi-item tasks. Demo must show:
capture → understanding → reasoning → organisation → retrieval → useful action. Not a superficial AI bookmark manager.

## 3. Platform
Desktop-first, macOS primary. Native, fast, lightweight, always available. Preferred: TypeScript, React, Tauri if
appropriate, SQLite, local filesystem for originals, clean abstraction around MiniMax/GMI Cloud API, local full-text
search, vector/semantic search where useful. Use judgment on architecture but preserve local-first ownership, native
filesystem access, drag/drop, low idle resource usage, fast startup, easy packaging. No required remote database.

## 4. Local-first principle
Originals belong to the user. Do NOT aggressively reorganise, rename, move or mutate files. Preserve either a safe
reference to the original or a controlled local copy inside the managed object store depending on import mode.
Semantic organisation exists inside KeepAnything: one PDF may belong to AI Research, MiniMax, Hackathon, Things to
Read, Agent Architecture without duplication. Internal architecture must make this explicit:
Physical object → KeepAnything object record → extracted content → AI understanding → semantic relationships →
collections.

## 5. Main capture interaction
When the user begins dragging something on macOS, KeepAnything should be able to expose a small floating drop target /
shelf (Yoink-like): drag begins → shelf appears near the screen edge → drop → subtle confirmation → shelf disappears →
object processed asynchronously. Never block the user's workflow on AI processing. Capture should feel instantaneous.
Support at minimum: files, multiple files, folders, images, screenshots, PDFs, plain text, markdown, URLs, dragged
links from browsers. Importer must be extensible. Anticipate (don't implement yet): Share extension, browser
extension, clipboard capture, keyboard shortcut, mobile share sheet, email forwarding.

## 6. URL capture
URLs are durable library objects, not raw bookmarks. Store URL, canonical URL, title, description, domain, favicon,
Open Graph image, page type, captured timestamp; preserve extracted readable content locally where practical.
Recognise: article, product website, GitHub repository, X/Twitter post, YouTube page, documentation, Figma link,
social post, research paper. Generic URL capture first; specialised extractors where they materially help; adapters
extensible.

## 7. Folder import
A folder is a unit, not just N files. Inspect folder name, structure, file types, contents where reasonable,
relationships between contained items; infer whether it is a coherent project/topic ("This looks like research
material for a product project…"). May create a semantic collection for the folder while preserving individual
objects. Sensible limits, sampling, summarisation, staged processing. Never send enormous folders blindly.

## 8. Library UI
Primary screen is a visual personal library: premium, restrained, native desktop feel, editorial, warm, calm,
minimal, highly visual, no generic SaaS dashboard. Pinterest + Finder + Are.na + personal inspiration library.
Masonry/card layout; cards strongly reflect content: images show the image; videos thumbnail + play; websites
captured visual / OG image; PDF first-page preview; GitHub rich repo preview; text elegant text card; folder visual
stack/collage. Not identical database rows.

## 9. Navigation
Sidebar: Library, Links, Files, Collections, Trash. Below: AI-generated / user collections (e.g. mnismt,
Design References, AI Infrastructure, Things to Read). Bottom: Settings. Keep it simple.

## 10. Processing state on cards
Captured objects enter an in-progress state until the pipeline settles. The user does not process items manually.
Lifecycle: captured → extracting → understanding → relating → organised. Each card surfaces its current state with
a small dot and one short label ("Still figuring this one out.", "Couldn't read this, but it's kept.").
Failures are recoverable: a card with a failed state exposes "Try again". Library sorts by capture time so the most
recently kept items are at the top. The original is never lost.

## 11. Item detail view
Original shown prominently. Then: Understanding (concise, specific: "An engineering article comparing inference
batching strategies, mainly useful as a reference for reducing GPU serving cost", never "This article discusses AI"),
why it might be useful; Connections (related items with semantic meaning); Collections; Actions dependent on object
type (repo: Explain architecture / Compare with saved repos / Extract useful ideas / Read README; article: Summarise
argument / Extract claims / Compare with related / Add to research brief; image/design: Describe visual language /
Find similar references / Extract typography/colours/layout ideas; receipt: Extract transaction / Find related
purchases). The model may suggest relevant actions.

## 12. The reasoning agent
Every captured object goes through an agentic understanding pipeline answering: What is this? What information does
it contain? Why would someone keep this? What existing objects are related and how? Does it belong to an existing
collection? Is a new collection justified? Should an existing collection be renamed/expanded? Can something useful be
derived? Structured output. The LLM must not mutate the database arbitrarily: explicit tool/function system
(inspect_item, read_document, inspect_folder, search_library, semantic_search, get_related_items, list_collections,
inspect_collection, create_collection, add_to_collection, create_relationship, update_item_understanding,
create_note, suggest_action). Reason → select tools → inspect results → change state through controlled APIs.
Every mutation auditable.

## 13. Model output
Structured outputs (objectType, title, summary, whyUseful, topics, entities, suggestedRelationships,
suggestedCollections, confidence). Never parse freeform prose into application state. Separate model reasoning,
application state and persistence.

## 14. Relationships
Not just tags: a lightweight relationship graph — related_to, inspired_by, same_project, references, alternative_to,
continuation_of, contradicts, duplicate_of, created_from, belongs_to, AI-generated with confidence scores.

## 15. Collections
Semantic views; items belong to many without duplication. Created by a person or the agent, both kinds work the same
way: the description tells the agent what belongs there, and every membership is a row in the table. Good names are
ongoing contexts ("mnismt visual direction", "Local LLM inference research", "macOS utility references", "MiniMax
Hackathon"). The agent is conservative: avoid "Technology / Websites / Software / Internet" and any single topic word;
prefer adding to an existing collection over creating a similar one, and prefer doing nothing over creating something
vague.

## 16. Search / command interface
Cmd+K central. Simple queries ("minimax", "hyperliquid", "github") behave like fast local search. Natural-language
queries ("find that open-source mac app I saved recently", "show the website with a globe animation", "what did I
save about cheaper Resend alternatives?") invoke semantic retrieval + reasoning. Understand imperfect memory.

## 17. "Ask My Stuff"
Agentic retrieval: question → interpret memory cues → likely types/topics/time ranges → search → inspect candidates
→ refine → answer with supporting items. Result shows the source objects, not just an AI answer.

## 18. Multi-item reasoning
Select multiple objects: Compare these / What do these have in common? / Summarise this research / Turn these into a
brief / Extract the key ideas / Which one should I use? / Create a note from these. Agent inspects all items,
reasons across them, creates a new artifact inside KeepAnything with references back to sources.

## 19. Automatic insight
Not annoyingly proactive, but may notice meaningful patterns (competitor pages saved over days → "Competitive
research"). Conservative: don't interrupt unless confidence and usefulness are high; most automatic actions silent and
reversible.

## 20. Embeddings and retrieval
Embeddings for candidate retrieval, not the whole intelligence layer: cheap local filtering → text/metadata search →
embeddings → candidates → reasoning model → decision. Never send the whole library to an LLM; keep tokens reasonable.

## 21. Content extraction
Extensible pipeline: text (direct), markdown (content + headings), PDF (text + page preview), images (metadata +
vision), URLs (title, metadata, content, preview), folders (safe traversal with limits), unknown binaries (store
safely). Always distinguish stored successfully from understood successfully.

## 22. Privacy
Make local-first visible: distinguish data stored locally vs sent to an AI provider. Provider behind an abstraction
(analyzeObject, reason, embed, generateStructuredOutput). Integrate MiniMax through GMI Cloud; provider config
isolated so model versions change without rewriting the app. Only send what a specific task needs.

## 23. Database model
Item (id, type, title, originalPath, managedPath, url, mimeType, size, createdAt, capturedAt, modifiedAt,
processingStatus, understanding, whyUseful, metadata JSON, extractedText, thumbnailPath); Collection (id, name,
description, createdBy, createdAt); CollectionItem (collectionId, itemId, confidence, reason, addedBy);
generated artifacts as Items; AgentRun (id, itemId, task, status, model, startedAt, completedAt, toolCalls, result,
error) for debugging and demos.

## 24. Processing pipeline
Background jobs: CAPTURED → EXTRACTING → EXTRACTED → EMBEDDING → UNDERSTANDING → RELATING → READY; failure states
EXTRACTION_FAILED, AI_FAILED, PARTIAL; stages retryable; AI never blocks adding items.

## 25. Visual quality
Software someone keeps open every day. Avoid excessive borders, cards within cards, giant empty metrics, neon AI
gradients, pills everywhere, generic shadcn-dashboard look, clutter, emoji-heavy UI, marketing headings in-app.
Prefer subtle typography hierarchy, breathing room, careful spacing, smooth transitions, native controls, contextual
menus, keyboard shortcuts, restrained shadows, good thumbnails, content-first. Dark mode must look particularly good.
Reference: Raycast, Linear, Arc-era macOS apps, Are.na, Pinterest density, Apple utilities, without cloning.

## 26. Interactions
drag → capture shelf appears; drop → immediate acknowledgement; hover card → subtle controls; double click → detail;
Space → Quick Look; Cmd+K → search/command; Cmd+A select; Shift-click multi-select; Delete → Trash; drag cards →
collection; right click → contextual menu. Usable without AI visibly in the way.

## 27. Agent transparency
No chain-of-thought exposure, but explain organisation briefly: 'Added to "mnismt" — Because: landing-page visual
reference related to 4 existing mnismt items'; 'Related to "SKUD intro video" — Shared theme: premium software
advertising'. Users can undo, remove relationship, remove from collection, rename collection, override understanding.
User corrections take precedence over future automatic organisation.

## 28. MVP scope
Polished vertical slice: app launches; beautiful library UI; drag/drop files; drag URLs; local persistence;
thumbnails/previews; extraction pipeline; MiniMax understanding; semantic relationships; automatic collections;
natural-language search; item detail; multi-item compare/summarise. Later: global floating drag shelf, Share
extensions, browser extension, saved searches, advanced parsers. Core product must work even if
macOS-level drag interception is technically expensive.

## 29. Demo scenario
Empty library. Drag in: a MiniMax article, a GitHub repository, an AI infrastructure PDF, a product screenshot, a Doan
Labs design reference, another model provider page, a random research note. No tags/folders. Library develops
relationships/collections. Ask "What am I researching here?" → agent searches, reasons, identifies a theme, cites
objects. Ask "Turn my inference research into a short comparison." → agent searches, inspects, extracts facts,
compares, generates a note linked to sources. Demonstrates understanding context, planning retrieval, selecting
tools, reasoning across objects, creating output, not simple classification.

## 30. Principles
1 Capture easier than organisation. 2 Never require organisation at capture time. 3 AI reduces UI. 4 Preserve
originals; organisation semantic and reversible. 5 Relationships > folders. 6 Reason before acting. 7 Useful work,
not AI theatre (no fake thinking animations, no streaming for show). 8 Original content remains the hero; AI is
infrastructure.

## 31. Voice
Understated personality. Good: "Keep anything." "We'll figure out the rest." "Saved." "Found 4 related things."
"This looks like part of your MiniMax research." "Still figuring this one out." "Couldn't read this page, but the link
is safe." Bad: "Harness the power of AI…", "Unlock your second brain", "revolutionary AI".

## 32. Engineering quality
Strict TypeScript, modular architecture, DB migrations, robust error handling, structured logging, clear AI-provider
abstraction, tests for core data operations and reasoning tool boundaries, duplicate-import prevention, graceful
handling of deleted/missing files, no secrets committed, documented env/config, graceful offline behaviour, AI
failures never corrupt library state. Sensible libraries; no premature microservices.

## 33. Code organisation
desktop/ ui/ core/ storage/ capture/ extraction/ ai/ agent/ retrieval/ previews/ (names may follow framework
conventions; preserve boundaries).

## 34. Implementation strategy
Inspect repo → short plan → vertical slices: Foundation → Capture → Library → Understanding → Organisation →
Reasoning → Commands → Multi-item → Native polish. Keep the app runnable at every stage.

## Final product test
"Can I see something interesting on the internet, throw it into KeepAnything without thinking, and reliably find/use
it months later even if I barely remember what it was?" If the app becomes bookmarks + tags + chatbot, the idea is lost.
KeepAnything should feel like a quiet intelligence between "I want to keep this" and "I need this again."

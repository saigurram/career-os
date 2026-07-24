-- Curriculum depth expansion: 42 -> 85 AI concepts (adds Tier 5), 34 -> 48 curriculum units.
-- Adds pgvector-based embedding columns for a true (semantic) never-repeat guarantee on
-- interview questions and generated curriculum content, on top of the existing lexical filter.
-- Also repositions the human-mock milestone units proportionally onto the longer program.

-- ============================================================
-- PGVECTOR EXTENSION
-- ============================================================
create extension if not exists vector;

-- ============================================================
-- AI CONCEPTS: widen tier constraint to allow Tier 5, then seed 43 new rows
-- ============================================================
-- The original constraint (001_initial_schema.sql) is unnamed, so Postgres assigned it the
-- default name `ai_concepts_tier_check`. If your live DB has a different name (check via
-- `\d ai_concepts` in the Supabase SQL editor), update the DROP CONSTRAINT line to match
-- before running this migration.
alter table public.ai_concepts drop constraint if exists ai_concepts_tier_check;
alter table public.ai_concepts add constraint ai_concepts_tier_check check (tier between 1 and 5);

insert into public.ai_concepts (concept_number, name, tier, description, why_pm_needs_it) values
-- Tier 1 — Foundations (7 new: 43-49)
(43, 'Transformer architecture at a PM-conversational depth', 1, 'The attention-based architecture underlying modern LLMs, described at a level a PM can reason with and explain, not implement', 'PMs need enough architectural intuition to have credible technical conversations with engineering without pretending to be one'),
(44, 'Tokenization and vocabulary practicalities', 1, 'How raw text is broken into tokens, including multilingual and code tokenization quirks that affect cost and quality', 'PMs scoping multilingual or code-heavy features must understand why token counts and pricing vary unexpectedly by language and content type'),
(45, 'Embeddings deep dive: similarity, dimensionality, model choice', 1, 'How embedding models turn text into vectors, what cosine similarity actually measures, and how dimensionality trade-offs affect cost and recall', 'PMs designing search, recommendation, or dedup features need to reason about embedding model choice, not just call it a black box'),
(46, 'Vector database internals (ANN search, HNSW vs IVF)', 1, 'How approximate nearest-neighbor indexes trade off build time, query latency, and recall, and when the index type matters for a product', 'PMs evaluating vector DB vendors or scoping search latency SLAs need to know these trade-offs exist and what to ask engineering'),
(47, 'Prompt caching and its cost/latency implications', 1, 'How caching repeated prompt prefixes reduces cost and latency on subsequent calls', 'PMs speccing high-volume AI features must understand prompt caching to avoid over-budgeting for inference cost'),
(48, 'Batch vs streaming inference trade-offs', 1, 'When to process AI requests as a batch job versus a real-time streaming call', 'PMs choosing between batch and real-time architectures need to know the cost, latency, and UX trade-offs each implies'),
(49, 'Token economics 101', 1, 'How input and output tokens are priced differently, and how context length scales cost non-linearly for some workloads', 'PMs must model per-user AI cost accurately to price features and set usage limits that do not blow the budget'),
-- Tier 2 — Core Technical (9 new: 50-58)
(50, 'RAG vs fine-tuning vs prompting: a PM decision framework', 2, 'A structured framework for choosing between retrieval, fine-tuning, and prompting based on data freshness, cost, and accuracy needs', 'This is the single most common technical scoping decision a PM makes on an AI feature and needs a repeatable framework, not a gut call'),
(51, 'Chunking and retrieval strategy trade-offs', 2, 'How document chunk size, overlap, and retrieval ranking affect RAG answer quality', 'PMs shipping RAG features must know why retrieval quality degrades and what levers exist to fix it'),
(52, 'Agentic tool-use interface design', 2, 'Principles for designing which tools an AI agent can call, how narrowly to scope them, and how to prevent misuse', 'PMs specifying agent capabilities must define tool boundaries precisely or ship an agent that does things nobody approved'),
(53, 'Multi-step agent planning (task decomposition, plan-execute-reflect)', 2, 'Patterns for breaking a complex goal into a sequence of agent actions with checkpoints for review', 'PMs designing multi-step agentic workflows need to know how planning loops fail so they can spec review checkpoints correctly'),
(54, 'Agent memory architectures (short-term, episodic, long-term)', 2, 'How agents persist context across a session versus across sessions, and the trade-offs of each', 'PMs designing personalized or long-running agent features must understand memory trade-offs and their privacy implications'),
(55, 'Cost/latency unit-economics modeling for AI features', 2, 'How to build a per-request cost and latency model for an AI feature before it ships', 'PMs must justify AI feature economics to leadership with real numbers, not vibes, before requesting engineering investment'),
(56, 'Model cascading and routing', 2, 'Routing simple requests to cheap models and complex ones to expensive models to optimize cost without sacrificing quality where it matters', 'PMs scoping AI cost at scale need to know cascading is an option, not just "use the best model for everything"'),
(57, 'Prompt-caching economics at the product level', 2, 'How caching strategy at the product level (shared system prompts, repeated context) compounds savings across users', 'PMs must design product architecture, not just individual prompts, to capture caching savings at scale'),
(58, 'Streaming UX for agentic, multi-step outputs', 2, 'UX patterns for showing users an agent''s intermediate steps and reasoning as it works, not just a final answer', 'PMs shipping agentic features must spec how much of the agent''s process to expose, since hiding it all erodes trust and showing too much overwhelms users'),
-- Tier 3 — Applied PM Skills (8 new: 59-66)
(59, 'Hallucination mitigation techniques (grounding, citations, confidence scoring)', 3, 'Product-level techniques to reduce and surface hallucinations, including citing sources and exposing model confidence', 'PMs must spec concrete hallucination mitigations as product requirements, not just tell engineering to "reduce hallucinations"'),
(60, 'Guardrail design patterns', 3, 'Patterns for input and output filtering, escalation paths, and refusal behavior in AI products', 'PMs must spec guardrails precisely enough that trust and safety requirements are testable, not vague aspirations'),
(61, 'AI-specific A/B testing (non-determinism, novelty effects)', 3, 'How generative output variability and user novelty effects distort standard A/B test results', 'PMs running experiments on generative features must account for non-determinism or they will draw false conclusions from noisy data'),
(62, 'Bias and fairness test design for AI features', 3, 'How to construct test sets and metrics that surface biased or unfair AI behavior before launch', 'PMs are accountable for fairness outcomes and must be able to spec what a fairness test suite actually checks'),
(63, 'Human-in-the-loop escalation design', 3, 'Patterns for routing low-confidence or high-stakes AI decisions to a human reviewer', 'PMs must decide exactly when and how a human enters the loop, since getting this wrong creates either bottlenecks or unsafe automation'),
(64, 'Synthetic data for building eval sets', 3, 'Using generated data to construct evaluation sets when real labeled data is scarce or sensitive', 'PMs must know when synthetic eval data is trustworthy versus when it produces misleadingly clean results'),
(65, 'EU AI Act risk tiers and product scope implications', 3, 'How the EU AI Act classifies AI systems by risk tier and what obligations attach to each tier', 'PMs shipping into EU markets must know which risk tier their feature falls into before committing to a launch timeline'),
(66, 'US and India regulatory frameworks for AI (NIST AI RMF, emerging India rules)', 3, 'Current voluntary and emerging mandatory AI governance frameworks in the US and India', 'PMs in the Hyderabad market need working knowledge of India''s emerging AI policy alongside US frameworks their global employer may follow'),
-- Tier 4 — Frontier (8 new: 67-74)
(67, 'Open vs closed model selection trade-offs', 4, 'Trade-offs between open-source and commercial closed models on cost, customization, data privacy, and capability', 'PMs make build-vs-buy model decisions that affect margin and defensibility and must own this trade-off explicitly'),
(68, 'Distillation and small-model strategy', 4, 'Using a larger model to train a smaller, cheaper model that approximates its behavior for a narrower task', 'PMs scoping cost-sensitive features at scale need to know when a distilled small model is the right call instead of a frontier model'),
(69, 'On-device vs cloud inference trade-offs', 4, 'Trade-offs between running inference locally on a device versus in the cloud, on latency, privacy, and cost', 'PMs designing mobile or privacy-sensitive AI features must weigh on-device constraints against cloud capability'),
(70, 'AI safety and alignment fundamentals (PM awareness level)', 4, 'Core concepts in AI alignment and safety research, at a level sufficient for informed product decisions, not research contribution', 'PMs shipping powerful AI features should understand alignment basics well enough to ask engineering the right safety questions'),
(71, 'Red-teaming program design for AI features', 4, 'How to structure an adversarial testing program to find failure modes before a launch', 'PMs are responsible for commissioning red-teaming before a risky AI feature ships and must know what a real program looks like'),
(72, 'Prompt injection and jailbreak defenses', 4, 'Attack patterns where malicious input hijacks AI behavior, and the defenses available against them', 'PMs shipping AI features that process untrusted user or third-party content must understand this attack surface to spec defenses'),
(73, 'Canary and shadow deployment patterns for AI models', 4, 'Deployment strategies that test a new model version on a small slice of traffic or in parallel without affecting users, before full rollout', 'PMs must know these patterns exist to require them as a launch gate for any model change that could regress quality'),
(74, 'Drift detection and monitoring at the PM level', 4, 'How to detect when a deployed model''s real-world performance degrades over time due to changing data or usage patterns', 'PMs own the post-launch quality of AI features and must specify what gets monitored to catch drift before users notice'),
-- Tier 5 — System-Design Depth (NEW, 11 concepts: 75-85)
(75, 'Design a RAG pipeline end to end', 5, 'A system-design-level exercise: architecting ingestion, chunking, retrieval, ranking, and generation for a production RAG system', 'This is a standard system-design-round question at senior/staff AI PM interviews and requires fluency across the whole pipeline, not just one stage'),
(76, 'Design an eval harness for a new AI feature', 5, 'A system-design-level exercise: architecting a repeatable evaluation system covering accuracy, safety, and regression testing before and after launch', 'Senior AI PM interviews increasingly probe whether a candidate can design measurement infrastructure, not just describe a feature'),
(77, 'Design an agent orchestration system with tool-use guardrails', 5, 'A system-design-level exercise: architecting how multiple tools, permission boundaries, and approval steps compose into a safe agentic system', 'This tests whether a candidate can reason about agent systems at an architectural level, the top interview differentiator for AI-native PM roles'),
(78, 'Design a cost/latency budget for a real-time AI feature at scale', 5, 'A system-design-level exercise: allocating a cost and latency budget across model calls, caching, and fallback paths for a feature serving millions of requests', 'This tests whether a candidate can translate unit economics into a concrete technical budget, a common gap even among experienced PMs'),
(79, 'Design a hallucination-mitigation strategy for a customer-facing assistant', 5, 'A system-design-level exercise: combining grounding, confidence thresholds, citation, and escalation into one coherent trust strategy', 'This is a frequently asked system-design question for any customer-facing AI assistant role and tests end-to-end trust design, not one trick'),
(80, 'Design a model-routing/cascading system', 5, 'A system-design-level exercise: architecting the decision logic, monitoring, and fallback behavior of a multi-model routing system', 'Tests whether a candidate can design for cost efficiency at scale without treating "just use the best model" as the answer'),
(81, 'Design a data-flywheel/feedback-loop architecture', 5, 'A system-design-level exercise: architecting how user interactions become training or eval signal that compounds product quality over time', 'This tests strategic thinking about long-term competitive moats, a hallmark question at the Principal PM level'),
(82, 'Design a red-team and safety-testing program for a launch', 5, 'A system-design-level exercise: architecting an end-to-end adversarial testing and sign-off process gating a risky AI launch', 'Tests whether a candidate can operationalize safety as a process, not just cite it as a value'),
(83, 'Design a multi-agent system with cross-session memory', 5, 'A system-design-level exercise: architecting how multiple specialized agents collaborate and share persistent memory across sessions', 'This is an emerging and frequently asked frontier system-design question as multi-agent products become mainstream'),
(84, 'Design an AI feature rollout using canary/shadow deployment', 5, 'A system-design-level exercise: architecting a full rollout plan with shadow testing, canary traffic, rollback triggers, and success criteria', 'Tests operational maturity: whether a candidate can design a safe path to production, not just describe the feature itself'),
(85, 'Design a compliance-ready AI architecture for a regulated-industry scenario', 5, 'A system-design-level exercise: architecting an AI system that satisfies EU AI Act or sector-specific regulatory requirements by design', 'Tests whether a candidate can design for compliance as an architectural constraint rather than a bolt-on afterthought, increasingly expected at senior levels');

-- ============================================================
-- CURRICULUM UNITS: 14 new rows (35-48)
-- primary_theme follows the same (unit_number - 1) % 6 rotation that
-- getPillarForUnit() in src/lib/claude.ts computes independently at runtime,
-- so the seed stays consistent with what the app would derive on its own.
-- ============================================================
insert into public.curriculum_units (unit_number, phase, primary_theme, required_ai_concept_tier, pow_type_constraint, is_interview_heavy, is_materials_heavy) values
-- Tier 4 concepts (units 35-40)
(35, 'phase1', 'Interview readiness & story building', 4, 'notion_doc', true, false),
(36, 'phase1', 'Application materials & external visibility', 4, 'linkedin_post', false, true),
(37, 'phase1', 'GenAI & AI concepts', 4, 'github_repo', false, false),
(38, 'phase1', 'Platform & Principal PM thinking', 4, 'product_spec', false, false),
(39, 'phase1', 'Executive communication & owner framing', 4, 'linkedin_post', false, false),
(40, 'phase1', 'Hyderabad market & target company knowledge', 4, 'notion_doc', false, false),
-- Tier 5 concepts (units 41-48, system-design depth)
(41, 'phase1', 'Interview readiness & story building', 5, 'product_spec', true, false),
(42, 'phase1', 'Application materials & external visibility', 5, 'linkedin_post', false, true),
(43, 'phase1', 'GenAI & AI concepts', 5, 'github_repo', false, false),
(44, 'phase1', 'Platform & Principal PM thinking', 5, 'product_spec', false, false),
(45, 'phase1', 'Executive communication & owner framing', 5, 'linkedin_post', false, false),
(46, 'phase1', 'Hyderabad market & target company knowledge', 5, 'notion_doc', false, false),
(47, 'phase1', 'Interview readiness & story building', 5, 'product_spec', true, false),
(48, 'phase1', 'Application materials & external visibility', 5, 'linkedin_post', false, true);

-- ============================================================
-- HUMAN MOCK MILESTONES: reposition proportionally onto the 48-unit program
-- Original [26, 32] sat at ~76%/94% of a 34-unit program; [37, 45] preserve that
-- proportion on 48 units. Old values are kept (not dropped) so any historical
-- human_mock_sessions rows logged against 26/32 remain valid.
-- ============================================================
alter table public.human_mock_sessions drop constraint if exists human_mock_sessions_unit_number_check;
alter table public.human_mock_sessions add constraint human_mock_sessions_unit_number_check check (unit_number in (26, 32, 37, 45));

update public.curriculum_units set is_human_mock = true where unit_number in (37, 45);

-- ============================================================
-- EMBEDDINGS: pgvector columns for semantic (never-repeat) dedup
-- Dimension matches Voyage AI's voyage-3.5 model at output_dimension=1024.
-- ============================================================
alter table public.interview_questions add column if not exists embedding vector(1024);
alter table public.interview_questions add column if not exists user_id uuid references public.users(id) on delete cascade;

-- Backfill user_id on any existing interview_questions rows via their session's owner.
update public.interview_questions iq
set user_id = s.user_id
from public.interview_sessions s
where iq.session_id = s.id and iq.user_id is null;

alter table public.curriculum_unit_content add column if not exists embedding vector(1024);
alter table public.curriculum_unit_content_history add column if not exists embedding vector(1024);

create index if not exists idx_interview_questions_user on public.interview_questions(user_id);

-- IVFFlat indexes on the embedding columns are deferred until there is enough row volume
-- for the index to build usefully; a sequential scan is fine at low volume. Add later via:
--   create index idx_interview_questions_embedding on public.interview_questions
--     using ivfflat (embedding vector_cosine_ops);
--   create index idx_curriculum_content_embedding on public.curriculum_unit_content
--     using ivfflat (embedding vector_cosine_ops);

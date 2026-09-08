# Contributor instructions

- Write all model-facing instructions in English: system prompts, tool descriptions, prompt guidelines, Skills, and prompt templates. Use another language only when explicitly required by the task.
- Keep plugins independently usable. Integrations must be optional and use public interfaces rather than another plugin's internal state.
- Keep lifecycle state independent of presentation. Do not introduce a shared core package without demonstrated reuse.
- Keep the Subagent plugin generic. Do not embed role catalogs, planning tools, or delivery workflows in its execution layer.
- Read the relevant documentation for the installed Pi version before using its SDK or extension APIs. Verify behavior with tests; examples are references, not specifications.
- Distinguish verified behavior, proposed behavior, and unsupported guarantees in documentation.
- Do not run paid model tests or change global Pi configuration unless explicitly authorized.

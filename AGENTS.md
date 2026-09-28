# Repository conventions

- Use `gh` for GitHub operations, never browser automation.
- Keep dependency names simple. Pass core service dependencies as separate constructor parameters.
- Define services as documented interfaces with class implementations; avoid factories returning objects with methods.
- Validate incoming network events with Zod and infer their types from the schemas.
- Use braces around all control-flow bodies, enforced by Biome's `useBlockStatements` rule.
- Leave a blank line before and after control-flow statements within a block, between methods and declarations, and between logical steps. Biome preserves these blank lines but has no built-in rule enforcing this spacing.

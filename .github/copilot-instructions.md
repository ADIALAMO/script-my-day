# AI Coding Guidelines for My Life Script

## Project Overview
This is a comic script generator app ("My Life as a Movie") that transforms user diary entries into professional comic scripts. It supports Hebrew and English, with genre adaptation (drama, comedy, action, etc.).

## Architecture
- **Frontend**: Vanilla HTML/JS in `public/` with i18n, theme toggle, and form submission.
- **Backend**: Vercel serverless functions in `api/` calling OpenRouter AI API.
- **Core Logic**: Agent-based script generation in `lib/agent.js` using system prompts.
- **Data Flow**: User input → Joi validation → Language detection → AI prompt building → OpenRouter API → Post-processing → Script output.

## Key Workflows
- **Local Development**: Run `npm start` to test API locally (requires OPENROUTER_API_KEY in .env).
- **Deployment**: Automatic via Vercel with `vercel.json` routing static files to `public/` and API to `api/`.
- **Script Generation**: Uses "ScriptCraft" agent with strict rules: preserve all events chronologically, no factual alterations, output in user's language.
- **Error Handling**: Retry incomplete scripts up to 3 times, validate input length (3-3000 chars), handle API timeouts (20s).

## Conventions
- **Language Support**: Detect Hebrew/English automatically; output matches input language.
- **Prompt Engineering**: System prompt enforces event preservation; extra instructions aim for 6-10 panels.
- **Validation**: Joi schemas for API inputs; trim journal entries to 300 words max.
- **File Structure**: API functions in `api/`, shared logic in `lib/`, static assets in `public/`.
- **Dependencies**: Axios for API calls, dotenv for secrets; no build step (serverless).

## Examples
- **Genre Mapping**: Input "drama" → Hebrew "דרמה" in prompts.
- **Script Format**: Panels/scenes with "INT/EXT. Location - Time" descriptions, dialogue as "Character: 'text'".
- **Continuation**: If script incomplete, append continuation prompts until "END" or 4000 chars.

## Integration Points
- **OpenRouter API**: Model `google/gemma-3-27b-it:free`, fallback to direct prompts for non-agent cases.
- **Environment**: Requires `OPENROUTER_API_KEY`; supports `OPENROUTER_API_URL` override.
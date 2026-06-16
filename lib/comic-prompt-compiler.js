const MAX_COMIC_PROMPT_WORDS = 64;

const FINE_MOTOR_ACTION_PATTERN =
  /\b(holding|holds|held|gripping|grips|gripped|clutching|clutches|clutched|pointing|points|pointed|reaching|reaches|reached|grabbing|grabs|grabbed|typing|types|typed|writing|writes|wrote|scribbling|scribbles|scribbled|pouring|pours|poured|drinking|drinks|drank|wielding|wields|wielded|aiming|aims|aimed)\b[^,.;]*/gi;

const COMPLEX_ACTION_PATTERNS = [
  /\b(holding|holds|held|gripping|grips|gripped|clutching|clutches|clutched)\b/gi,
  /\b(pointing|points|pointed|gesturing|gestures|gestured)\b/gi,
  /\b(grabbing|grabs|grabbed|pulling|pulls|pulled|pushing|pushes|pushed)\b/gi,
  /\b(typing|types|typed|writing|writes|wrote|scribbling|scribbles|scribbled)\b/gi,
  /\b(pouring|pours|poured|drinking|drinks|drank|eating|eats|ate)\b/gi,
  /\b(punching|punches|punched|kicking|kicks|kicked|throwing|throws|threw)\b/gi,
  /\b(running|runs|ran|jumping|jumps|jumped|leaping|leaps|leapt)\b/gi,
  /\b(wielding|wields|wielded|aiming|aims|aimed)\b/gi,
];

const UNSAFE_CLAUSE_PATTERN =
  /\b(fingers?|hands?|arms?)\b.*\b(holding|gripping|pointing|reaching|grabbing|typing|writing|pouring|throwing|aiming|touching|manipulating)\b/i;

export const COMIC_NEGATIVE_PROMPT = [
  'extra fingers',
  'missing fingers',
  'fused fingers',
  'twisted fingers',
  'malformed hands',
  'extra hands',
  'disconnected hands',
  'hands detached from body',
  'extra arms',
  'extra legs',
  'missing limbs',
  'disconnected limbs',
  'twisted limbs',
  'broken wrists',
  'broken anatomy',
  'deformed anatomy',
  'distorted body',
  'mutated body',
  'merged bodies',
  'overlapping bodies',
  'duplicated person',
  'duplicate face',
  'extra head',
  'bad face',
  'asymmetrical eyes',
  'floating objects',
  'object fused to body',
  'object fused to face',
  'props merging with hands',
  'crowded background',
  'busy background',
  'text',
  'letters',
  'watermark',
  'logo',
  'speech bubbles',
  'caption boxes',
].join(', ');

function stableHash(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function truncateWords(text, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= maxWords ? text : words.slice(0, maxWords).join(' ');
}

function simplifyActionLanguage(text) {
  let simplified = text.replace(FINE_MOTOR_ACTION_PATTERN, 'with hands mostly out of frame');
  for (const pattern of COMPLEX_ACTION_PATTERNS) {
    simplified = simplified.replace(pattern, 'standing calmly');
  }
  return simplified
    .replace(/\bwith\s+both\s+hands\b/gi, 'with hands mostly out of frame')
    .replace(/\bhands?\s+visible\b/gi, 'hands mostly out of frame')
    .replace(/\bfingers?\s+visible\b/gi, 'hands mostly out of frame');
}

function removeUnsafeClauses(text) {
  const seen = new Set();
  return text
    .split(/\s*(?:,|;|\.\s+|\s+-\s+|\s+--\s+)\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !UNSAFE_CLAUSE_PATTERN.test(part))
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(', ');
}

export function compileComicPrompt(agentPrompt = '') {
  const normalized = String(agentPrompt || '')
    .replace(/\[image:\s*/i, '')
    .replace(/\]$/, '')
    .replace(/[(){}[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const actionSafe = simplifyActionLanguage(normalized);
  const clauseSafe = removeUnsafeClauses(actionSafe)
    .replace(/\bwith hands mostly out of frame,\s*with hands mostly out of frame\b/gi, 'with hands mostly out of frame');
  const coreScene = truncateWords(clauseSafe || 'A single character in a simple comic scene', MAX_COMIC_PROMPT_WORDS);

  return [
    'Clean inked comic lineart, single clear focal subject, stable waist-up medium shot',
    coreScene,
    'simple readable background, hands relaxed and mostly out of frame, coherent lighting, clean anatomy',
  ].join('. ');
}

export function makePanelSeed(comicSeed, panelIndex = 0) {
  const root = String(comicSeed || 'lifescript-comic');
  const idx = Number.isFinite(Number(panelIndex)) ? Number(panelIndex) : 0;
  return stableHash(`${root}:panel:${idx}`) % 1000000;
}

export function makeComicSeedRoot(value) {
  return stableHash(value || 'lifescript-comic-root') % 1000000;
}

import communityNews from './communityNews.md';
import aceAviator from './aceAviator.md';
import productGroup from './productGroup.md';
import dateWindow from './dateWindow.md';
import { isSkillPromptKey, type SkillPromptKey } from './skillDetection.js';

export const SKILL_PROMPTS: Record<SkillPromptKey, string> = {
  communityNews,
  aceAviator,
  productGroup,
  dateWindow,
};

export function buildDynamicPrompt(
  basePrompt: string,
  skillKeys: readonly string[],
): string {
  if (!skillKeys || skillKeys.length === 0) {
    return basePrompt;
  }

  const skillPrompts = skillKeys
    .filter(isSkillPromptKey)
    .map(key => SKILL_PROMPTS[key])
    .join('\n\n---\n\n');

  return `${basePrompt}

---

${skillPrompts}`;
}

export { detectRequiredSkills, isSkillPromptKey, SKILL_PROMPT_KEYS } from './skillDetection.js';
export type { SkillPromptKey } from './skillDetection.js';

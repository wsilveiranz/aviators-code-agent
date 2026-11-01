export type SkillPromptKey =
  'communityNews' |
  'aceAviator' |
  'productGroup' |
  'dateWindow';

export const SKILL_PROMPT_KEYS = [
  'communityNews',
  'aceAviator',
  'productGroup',
  'dateWindow',
] as const satisfies readonly SkillPromptKey[];

export function detectRequiredSkills(message: string): SkillPromptKey[] {
  const lowerMessage = message.toLowerCase();
  const skills: SkillPromptKey[] = [];

  // Community News detection
  if (
    lowerMessage.includes('community') ||
    lowerMessage.includes('linkedin') ||
    lowerMessage.includes('community news') ||
    lowerMessage.includes('community section')
  ) {
    skills.push('communityNews');
  }

  // Ace Aviator detection
  if (
    lowerMessage.includes('ace aviator') ||
    lowerMessage.includes('aviator of the month') ||
    lowerMessage.includes('q&a') ||
    lowerMessage.includes('interview') ||
    (lowerMessage.includes('email') && lowerMessage.includes('aviator'))
  ) {
    skills.push('aceAviator');
  }

  // Product Group detection
  if (
    lowerMessage.includes('product group') ||
    lowerMessage.includes('tech community') ||
    lowerMessage.includes('blog post') ||
    lowerMessage.includes('product news') ||
    (
      lowerMessage.includes('post') &&
      (
        lowerMessage.includes('override') ||
        lowerMessage.includes('include')
      )
    )
  ) {
    skills.push('productGroup');
  }

  // Date Window detection
  if (
    lowerMessage.includes('date window') ||
    lowerMessage.includes('pst window') ||
    lowerMessage.includes('time frame') ||
    lowerMessage.includes('date range')
  ) {
    skills.push('dateWindow');
  }

  // Full generation must be explicit. A month-specific newsletter or template
  // request initializes the artifact without forcing every section workflow.
  if (
    lowerMessage.includes('full newsletter') ||
    lowerMessage.includes('entire newsletter') ||
    lowerMessage.includes('all newsletter sections') ||
    lowerMessage.includes('generate all sections')
  ) {
    return ['dateWindow', 'aceAviator', 'productGroup', 'communityNews'];
  }

  return skills;
}

export function isSkillPromptKey(key: string): key is SkillPromptKey {
  return SKILL_PROMPT_KEYS.some(skillKey => skillKey === key);
}

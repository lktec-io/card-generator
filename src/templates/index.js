import WeddingGoldTemplate      from './WeddingGold';
import GraduationPremiumTemplate from './GraduationPremium';
import BirthdayModernTemplate    from './BirthdayModern';
import SendoffJourneyTemplate    from './SendoffJourney';
import ConferenceProTemplate     from './ConferencePro';

// Maps slug → React component
export const TEMPLATE_REGISTRY = {
  'wedding-gold':        WeddingGoldTemplate,
  'graduation-premium':  GraduationPremiumTemplate,
  'birthday-modern':     BirthdayModernTemplate,
  'sendoff-journey':     SendoffJourneyTemplate,
  'conference-pro':      ConferenceProTemplate,
  // These slugs fall back to WeddingGold until dedicated designs are added
  'church-elegant':      WeddingGoldTemplate,
  'kitchen-party':       BirthdayModernTemplate,
  'corporate-event':     ConferenceProTemplate,
};

// Category → emoji for gallery display
export const CATEGORY_EMOJI = {
  'Wedding':        '💍',
  'Graduation':     '🎓',
  'Birthday':       '🎂',
  'Sendoff':        '✈️',
  'Conference':     '💼',
  'Church Event':   '⛪',
  'Kitchen Party':  '🍽️',
  'Corporate Event': '🏢',
  'General':        '🎉',
};

/**
 * Resolve a template component by slug.
 * Falls back to WeddingGoldTemplate if slug is unknown.
 */
export function getTemplateComponent(slug) {
  return TEMPLATE_REGISTRY[slug] || WeddingGoldTemplate;
}

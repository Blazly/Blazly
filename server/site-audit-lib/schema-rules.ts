import type { CrawlSchemaNode } from './types/site-audit';

type SchemaRule = {
  match: RegExp;
  label: string;
  /** Each inner array is satisfied by any one of its properties. */
  required: string[][];
  recommended: string[][];
};

const LOCAL_BUSINESS =
  /(LocalBusiness|Store|Restaurant|Dentist|Physician|LegalService|Attorney|RealEstateAgent|AutoRepair|HomeAndConstructionBusiness|ProfessionalService|MedicalBusiness|FinancialService|HealthAndBeautyBusiness|LodgingBusiness)/;

export const SCHEMA_RULES: SchemaRule[] = [
  {
    match: /^(Article|BlogPosting|NewsArticle|TechArticle)$/,
    label: 'Article',
    required: [['headline', 'name']],
    recommended: [['author'], ['datePublished'], ['dateModified'], ['image'], ['publisher']],
  },
  {
    match: /^Product$/,
    label: 'Product',
    required: [['name'], ['offers', 'review', 'aggregateRating']],
    recommended: [['image'], ['description'], ['brand'], ['sku', 'gtin', 'mpn']],
  },
  { match: /^FAQPage$/, label: 'FAQPage', required: [['mainEntity']], recommended: [] },
  {
    match: /^(Organization|Corporation|OnlineBusiness|NGO|EducationalOrganization)$/,
    label: 'Organization',
    required: [['name'], ['url']],
    recommended: [['logo'], ['sameAs'], ['contactPoint', 'telephone', 'email'], ['description']],
  },
  {
    match: LOCAL_BUSINESS,
    label: 'LocalBusiness',
    required: [['name'], ['address']],
    recommended: [['telephone'], ['openingHoursSpecification', 'openingHours'], ['geo'], ['url'], ['image'], ['priceRange']],
  },
  { match: /^WebSite$/, label: 'WebSite', required: [['name'], ['url']], recommended: [['potentialAction']] },
  { match: /^BreadcrumbList$/, label: 'BreadcrumbList', required: [['itemListElement']], recommended: [] },
  {
    match: /^Event$/,
    label: 'Event',
    required: [['name'], ['startDate'], ['location']],
    recommended: [['endDate'], ['image'], ['offers'], ['organizer'], ['description']],
  },
  {
    match: /^Recipe$/,
    label: 'Recipe',
    required: [['name'], ['image']],
    recommended: [['recipeIngredient'], ['recipeInstructions'], ['author'], ['totalTime']],
  },
  { match: /^HowTo$/, label: 'HowTo', required: [['name'], ['step']], recommended: [] },
  {
    match: /^VideoObject$/,
    label: 'VideoObject',
    required: [['name'], ['thumbnailUrl'], ['uploadDate']],
    recommended: [['description'], ['contentUrl', 'embedUrl'], ['duration']],
  },
  { match: /^Review$/, label: 'Review', required: [['itemReviewed'], ['author'], ['reviewRating']], recommended: [] },
  {
    match: /^(SoftwareApplication|WebApplication|MobileApplication)$/,
    label: 'SoftwareApplication',
    required: [['name'], ['offers', 'aggregateRating', 'review']],
    recommended: [['operatingSystem'], ['applicationCategory']],
  },
  {
    match: /^Service$/,
    label: 'Service',
    required: [['name', 'serviceType']],
    recommended: [['provider'], ['areaServed'], ['description']],
  },
  { match: /^Person$/, label: 'Person', required: [['name']], recommended: [['url'], ['sameAs'], ['jobTitle']] },
  {
    match: /^JobPosting$/,
    label: 'JobPosting',
    required: [['title'], ['description'], ['datePosted'], ['hiringOrganization'], ['jobLocation', 'jobLocationType']],
    recommended: [['validThrough'], ['employmentType'], ['baseSalary']],
  },
  { match: /^Course$/, label: 'Course', required: [['name'], ['description']], recommended: [['provider']] },
];

export function nodeTypes(node: CrawlSchemaNode): string[] {
  return node.type.split(',').map((t) => t.trim()).filter(Boolean);
}

export function hasType(nodes: CrawlSchemaNode[], pattern: RegExp): boolean {
  return nodes.some((node) => nodeTypes(node).some((type) => pattern.test(type)));
}

export function schemaPropertyGaps(nodes: CrawlSchemaNode[]): { missingRequired: string[]; missingRecommended: string[] } {
  const missingRequired: string[] = [];
  const missingRecommended: string[] = [];
  for (const node of nodes) {
    for (const type of nodeTypes(node)) {
      const rule = SCHEMA_RULES.find((r) => r.match.test(type));
      if (!rule) continue;
      const props = new Set(node.props);
      for (const options of rule.required) {
        if (!options.some((prop) => props.has(prop))) missingRequired.push(`${rule.label}: ${options.join(' or ')}`);
      }
      for (const options of rule.recommended) {
        if (!options.some((prop) => props.has(prop))) missingRecommended.push(`${rule.label}: ${options[0]}`);
      }
      if (rule.label === 'FAQPage' && node.questions.some((q) => q.endsWith('[no answer]'))) {
        missingRequired.push('FAQPage: acceptedAnswer on every question');
      }
    }
  }
  return {
    missingRequired: [...new Set(missingRequired)],
    missingRecommended: [...new Set(missingRecommended)],
  };
}

export function suggestedSchema(pageType: string, isHome: boolean): string {
  if (isHome) return 'Organization and WebSite';
  switch (pageType) {
    case 'blog-article':
    case 'guide':
      return 'Article (or BlogPosting) and BreadcrumbList';
    case 'product':
    case 'pricing':
      return 'Product or SoftwareApplication with offers, plus BreadcrumbList';
    case 'service':
    case 'landing':
      return 'Service (with provider) and BreadcrumbList';
    case 'location':
    case 'contact':
      return 'LocalBusiness or Organization with address and contactPoint';
    case 'about':
      return 'Organization (or AboutPage) with logo and sameAs';
    default:
      return 'BreadcrumbList plus the type that matches the page (Article, Service, Product…)';
  }
}

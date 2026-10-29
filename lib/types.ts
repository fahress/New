export type Tag = { id: number; name: string; slug: string };

export type PersonType = 'designer' | 'foundry';

export type SocialLinks = {
  instagram_url?: string;
  behance_url?: string;
  linkedin_url?: string;
  website_url?: string;
  [key: string]: string | undefined;
};

export type Person = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  bio: string;
  social: SocialLinks;
  type: PersonType;
  fontIds: string[];
  from?: string;
  /** managed by the designer / foundry themselves (claimed profile) */
  claimed?: boolean;
};

export type FontAward = { awardId: string; url: string | null };

export type Award = { id: string; name: string; image: string | null };

export type Font = {
  id: string;
  name: string;
  slug: string;
  description: string;
  cover: string;
  images: string[];
  purchaseLinks: string[];
  caseStudies: string[];
  license: 'paid' | 'free' | 'custom' | string;
  year: number | null;
  weights: number | null;
  variable: boolean;
  featured: boolean;
  createdAt: string;
  people: string[];
  scripts: number[];
  styles: number[];
  types: number[];
  genres: number[];
  languageGroups: number[];
  languages: number[];
  awards: FontAward[];
};

export type Archive = {
  fonts: Font[];
  people: Person[];
  scripts: Tag[];
  styles: Tag[];
  types: Tag[];
  genres: Tag[];
  languageGroups: Tag[];
  languages: { id: number; name: string; nativeName: string }[];
  awards: Award[];
  fontBySlug: Map<string, Font>;
  fontById: Map<string, Font>;
  personBySlug: Map<string, Person>;
  personById: Map<string, Person>;
};

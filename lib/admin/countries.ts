/** Countries for the designer / foundry "From" field. Stored by English name, as shown on the site. */
const CODES = [
  'DZ','BH','KM','DJ','EG','IQ','JO','KW','LB','LY','MR','MA','OM','PS','QA','SA','SO','SD','SY','TN','AE','YE',
  'IR','TR','AF','PK','IN','BD','ID','MY','SG','CN','JP','KR','TH','PH','VN','AZ','KZ','UZ','TJ','TM','KG',
  'GB','IE','FR','DE','NL','BE','LU','CH','AT','IT','ES','PT','GR','CY','MT','DK','SE','NO','FI','IS','PL','CZ',
  'SK','HU','RO','BG','RS','HR','SI','BA','AL','MK','ME','UA','BY','RU','LT','LV','EE','GE','AM','MD',
  'US','CA','MX','BR','AR','CL','CO','PE','VE','UY','EC','BO','PY','CU',
  'NG','ET','KE','TZ','UG','GH','SN','ML','NE','TD','ER','ZA','ZW','CM','CI',
  'AU','NZ',
];

const OVERRIDES: Record<string, string> = { PS: 'Palestine', AE: 'United Arab Emirates', GB: 'United Kingdom', US: 'United States', KR: 'South Korea', CI: 'Ivory Coast', CZ: 'Czechia', BA: 'Bosnia and Herzegovina', MK: 'North Macedonia' };

export type Country = { code: string; name: string; flag: string };

const flagOf = (code: string) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

let names: Intl.DisplayNames | null = null;
try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { names = null; }

export const COUNTRIES: Country[] = CODES.map((code) => ({
  code,
  name: OVERRIDES[code] ?? names?.of(code) ?? code,
  flag: flagOf(code),
})).sort((a, b) => a.name.localeCompare(b.name));

const BY_NAME = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c]));
BY_NAME.set('uae', BY_NAME.get('united arab emirates')!);
BY_NAME.set('uk', BY_NAME.get('united kingdom')!);
BY_NAME.set('usa', BY_NAME.get('united states')!);

export const countryByName = (name: string | null | undefined) => (name ? BY_NAME.get(name.trim().toLowerCase()) ?? null : null);

/** Countries that come up most for Arabic type, shown first in the picker. */
export const COMMON = ['Saudi Arabia', 'Egypt', 'Lebanon', 'Iran', 'United Arab Emirates', 'Jordan', 'Morocco', 'Syria', 'Palestine', 'Iraq', 'Kuwait', 'Tunisia', 'Algeria'];

import Directory, { type DirEntry } from '@/components/Directory';
import { getArchive } from '@/lib/data';
import type { PersonType } from '@/lib/types';
import { countryOf } from '@/lib/places';

export async function DirectoryPage({ kind }: { kind: PersonType }) {
  const a = await getArchive();
  const pick = (t: PersonType) => a.people.filter((p) => p.type === t && p.fontIds.length > 0);
  const entries: DirEntry[] = pick(kind).map((p) => {
    const fonts = p.fontIds.map((id) => a.fontById.get(id)!).filter(Boolean);
    const names = fonts.slice(0, 2).map((f) => f.name);
    return {
      slug: p.slug,
      name: p.name,
      logo: p.logo,
      cover: fonts[0]?.cover ?? null,
      work: names.join(' · ') + (fonts.length > 2 ? ` · +${fonts.length - 2}` : ''),
      count: fonts.length,
      place: countryOf(p),
      country: countryOf(p),
      r: Math.random(),
    };
  });
  return (
    <>
      <section className="wrap rise" style={{ paddingBlock: '48px 28px' }}>
        <p className="mono" style={{ margin: '0 0 16px' }}>{kind === 'designer' ? 'The people behind the letters' : 'The studios that publish them'}</p>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(54px, 9vw, 150px)', letterSpacing: '-.05em', lineHeight: .86 }}>
          {kind === 'designer' ? 'Designers' : 'Foundries'}
        </h1>
      </section>
      <Directory kind={kind} entries={entries} counts={{ designers: pick('designer').length, foundries: pick('foundry').length }} />
    </>
  );
}

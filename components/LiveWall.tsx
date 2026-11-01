'use client';
import { useEffect, useState } from 'react';
import CoverField from './CoverField';
import RandomWall, { type WallFont } from './RandomWall';

/** The usual two scrolling rows; add ?wall=float to the address to preview the floating covers instead. */
export default function LiveWall({ pool }: { pool: WallFont[] }) {
  const [float, setFloat] = useState(false);
  useEffect(() => { setFloat(new URLSearchParams(window.location.search).get('wall') === 'float'); }, []);
  return float ? <CoverField pool={pool} /> : <RandomWall pool={pool} />;
}

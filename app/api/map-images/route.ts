import { NextResponse } from 'next/server';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const dir = join(process.cwd(), 'public', 'images', 'maps');
    const files = readdirSync(dir).filter(f => {
      const ext = f.toLowerCase().slice(f.lastIndexOf('.'));
      return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
    });
    const images = files.map(f => ({
      name: f,
      url: `/images/maps/${f}`,
      size: statSync(join(dir, f)).size,
    }));
    return NextResponse.json(images);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

import { NextResponse } from 'next/server';

/** Legacy evaluator shortcut — disabled. Product is open for ordinary users. */
export async function POST() {
  return NextResponse.json({ error: '该入口已停用，请直接打开应用使用。' }, { status: 410 });
}

import { NextResponse } from 'next/server';

export function createErrorResponse(message: string, status: number, code?: string): NextResponse {
  return NextResponse.json({ error: message, code, status }, { status });
}

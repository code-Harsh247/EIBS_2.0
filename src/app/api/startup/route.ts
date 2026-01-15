/**
 * GET /api/startup
 * 
 * Health check - event listener now runs as standalone process
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    message: 'Event listener runs as standalone process (use npm run dev:full)',
    timestamp: new Date().toISOString()
  });
}

      stack: error.stack
    }, { status: 500 });
  }
}

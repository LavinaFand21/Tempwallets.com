'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/ui/button';
import { Input } from '@repo/ui/components/ui/input';
import { Label } from '@repo/ui/components/ui/label';
import { yellowApi, AppSession } from '@/lib/yellow-api';
import { FieldError } from './field-error';

interface JoinSessionFormProps {
  userId: string;
  chain: string;
  onFound: (session: AppSession) => void;
}

export function JoinSessionForm({
  userId,
  chain,
  onFound,
}: JoinSessionFormProps) {
  const [sessionId, setSessionId] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!sessionId.trim()) {
      setError('Session ID is required');
      return;
    }
    setError(null);
    setSearching(true);
    try {
      const res = await yellowApi.getSession(sessionId.trim(), userId, chain);
      const session = res.data ?? res.session;
      if (res.ok && session) {
        toast.success('Session found!');
        onFound(session);
      } else {
        setError(res.message || 'Session not found or you are not a participant');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to find session');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-[#161616] border border-white/10 rounded-lg p-2.5 text-[11px] text-gray-200">
        <p className="font-medium mb-0.5">How joining works</p>
        <p>
          Enter a session ID to look up a session you were invited to. You must have
          been included as a participant when the session was created.
        </p>
      </div>

      <div>
        <Label className="text-xs text-gray-200">Session ID</Label>
        <Input
          placeholder="Paste session ID here..."
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          onBlur={() => setError(!sessionId.trim() ? 'Session ID is required' : null)}
          className="h-9 text-sm mt-1 font-mono bg-[#161616] border-white/10 text-white"
        />
        <FieldError msg={error} />
      </div>

      <Button
        onClick={handleSearch}
        disabled={searching}
        className="w-full bg-yellow-400 hover:bg-yellow-500 text-black"
      >
        {searching ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Searching…
          </>
        ) : (
          'Find Session'
        )}
      </Button>
    </div>
  );
}

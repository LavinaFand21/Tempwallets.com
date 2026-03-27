'use client';

import { ReactNode } from 'react';
import { Zap } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/ui/dialog';
import { AppSession } from '@/lib/yellow-api';
import { truncate } from './lightning-constants';

type DialogMode = 'create' | 'join' | 'manage';

interface SessionDialogProps {
  open: boolean;
  mode: DialogMode;
  managedSession: AppSession | null;
  loading: boolean;
  onClose: () => void;
  createContent: ReactNode;
  joinContent: ReactNode;
  manageContent: ReactNode;
}

export function SessionDialog({
  open,
  mode,
  managedSession,
  loading,
  onClose,
  createContent,
  joinContent,
  manageContent,
}: SessionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[480px] bg-[#161616] text-gray-100 border border-white/10 max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Zap className="h-4 w-4 text-yellow-300" />
            {mode === 'create' ? 'Create Session' : mode === 'join' ? 'Join Session' : 'Manage Session'}
          </DialogTitle>
          <DialogDescription className="text-gray-300 text-xs">
            {mode === 'create'
              ? 'Create a new Yellow Network app session for instant off-chain transfers.'
              : mode === 'join'
                ? 'Find a session you were invited to by entering its ID.'
                : `Session ${managedSession ? truncate(managedSession.appSessionId, 6) : ''}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1">
          {mode === 'create' && createContent}
          {mode === 'join' && joinContent}
          {mode === 'manage' && manageContent}
          {mode === 'manage' && loading && (
            <div className="text-center py-8 text-xs text-gray-400">Loading session details...</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@repo/ui/components/ui/dialog';
import { Button } from '@repo/ui/components/ui/button';
import { Input } from '@repo/ui/components/ui/input';
import { Label } from '@repo/ui/components/ui/label';
import { Loader2, Plus, CheckCircle2, AlertCircle } from 'lucide-react';
import { lightningNodeApi, LightningNode, walletApi } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

interface DepositFundsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lightningNode: LightningNode;
  onDepositComplete?: () => void;
}

export function DepositFundsModal({
  open,
  onOpenChange,
  lightningNode,
  onDepositComplete,
}: DepositFundsModalProps) {
  const { userId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [userAddressSet, setUserAddressSet] = useState<Set<string>>(new Set());

  // Form state
  const [amount, setAmount] = useState('');

  // Load user's wallet addresses so we can match the participant row correctly.
  useEffect(() => {
    let cancelled = false;
    if (!userId) return;

    (async () => {
      try {
        const payload = await walletApi.getAddresses(userId);
        const addressSet = new Set<string>();

        const push = (addr: string | null | undefined) => {
          if (!addr) return;
          addressSet.add(addr.toLowerCase());
        };

        push(payload.smartAccount?.address);
        Object.values(payload.smartAccount?.chains || {}).forEach(push);
        (payload.auxiliary || []).forEach((w) => push(w.address));

        if (!cancelled) setUserAddressSet(addressSet);
      } catch {
        if (!cancelled) setUserAddressSet(new Set());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Get current user's participant data
  const currentParticipant = lightningNode.participants.find(
    (p) => userAddressSet.has(p.address.toLowerCase())
  );

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setAmount('');
        setError(null);
        setSuccess(false);
      }, 300);
    }
  }, [open]);

  const handleDeposit = async () => {
    setError(null);

    // Validation
    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (!currentParticipant) {
      setError('You are not a participant in this Lightning Node');
      return;
    }

    if (!userId) {
      setError('User ID not found');
      return;
    }

    setLoading(true);

    try {
      // Convert amount to smallest units (assuming 6 decimals for USDC/USDT)
      const amountInSmallestUnits = (parseFloat(amount) * 1e6).toString();

      const response = await lightningNodeApi.depositFunds({
        userId,
        appSessionId: lightningNode.appSessionId,
        participantAddress: currentParticipant.address,
        amount: amountInSmallestUnits,
        asset: lightningNode.token.toLowerCase(),
      });

      if (response.ok) {
        setSuccess(true);

        // Notify parent to refresh data
        if (onDepositComplete) {
          onDepositComplete();
        }

        // Close modal after 1.5 seconds
        setTimeout(() => {
          onOpenChange(false);
        }, 1500);
      } else {
        setError('Failed to deposit funds. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deposit funds');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-black/90 text-white shadow-2xl backdrop-blur w-full max-w-[360px] p-6 rounded-2xl [&>button]:text-white [&>button]:hover:text-white [&>button]:hover:bg-white/20 [&>button]:opacity-100">
        <DialogHeader className="space-y-3">
          <DialogTitle className="text-xl font-rubik-medium text-white flex items-center gap-2">
            <Plus className="h-5 w-5 text-blue-400" />
            Deposit Funds
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-sm leading-relaxed">
            Add funds from your unified balance. This operation is gasless and instant.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-200 text-xs">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-200 text-xs">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-400" />
            <span>Funds deposited successfully!</span>
          </div>
        )}

        {!success && (
          <div className="space-y-5 py-2">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label htmlFor="amount" className="text-sm font-medium text-white">Amount</Label>
                <span className="text-xs text-gray-400">{lightningNode.token}</span>
              </div>
              <Input
                id="amount"
                type="number"
                step="0.000001"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={loading}
                className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:border-blue-500/50 focus:ring-blue-500/20 rounded-xl h-12 text-lg font-rubik-medium"
              />
            </div>

            {currentParticipant && (
              <div className="p-4 bg-white/5 border border-white/10 rounded-2xl">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1">Available to Deposit</p>
                <p className="text-xl font-rubik-medium text-white">
                  {(Number(currentParticipant.balance) / 1e6).toFixed(2)} <span className="text-sm text-gray-400 font-normal">{lightningNode.token}</span>
                </p>
              </div>
            )}
          </div>
        )}

        {success && (
          <div className="py-6">
            <p className="text-sm text-gray-400 text-center leading-relaxed">
              Your deposit has been processed. The Lightning Node balance will update shortly.
            </p>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-3 mt-4">
          {!success && (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={loading}
                className="w-full sm:flex-1 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl h-12"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleDeposit}
                disabled={loading || !amount || parseFloat(amount) <= 0}
                className="w-full sm:flex-[2] bg-white text-black hover:bg-gray-200 transition-all rounded-xl h-12 font-medium"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    Deposit
                  </>
                )}
              </Button>
            </>
          )}
          {success && (
            <Button
              type="button"
              onClick={() => onOpenChange(false)}
              className="w-full bg-white text-black hover:bg-gray-200 transition-all rounded-xl h-12 font-medium"
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/ui/select';
import { Label } from '@repo/ui/components/ui/label';
import { Loader2, ArrowRightLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { lightningNodeApi, LightningNode, LightningNodeParticipant, walletApi } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

interface TransferFundsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lightningNode: LightningNode;
  onTransferComplete?: () => void;
}

export function TransferFundsModal({
  open,
  onOpenChange,
  lightningNode,
  onTransferComplete,
}: TransferFundsModalProps) {
  const { userId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [userAddressSet, setUserAddressSet] = useState<Set<string>>(new Set());

  // Form state
  const [selectedRecipient, setSelectedRecipient] = useState<string>('');
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
  const otherParticipants = lightningNode.participants.filter(
    (p) => !userAddressSet.has(p.address.toLowerCase())
  );

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setSelectedRecipient('');
        setAmount('');
        setError(null);
        setSuccess(false);
      }, 300);
    }
  }, [open]);

  const handleTransfer = async () => {
    setError(null);

    // Validation
    if (!selectedRecipient) {
      setError('Please select a recipient');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (!currentParticipant) {
      setError('You are not a participant in this Lightning Node');
      return;
    }

    // Check if user has sufficient balance
    const amountInSmallestUnits = (parseFloat(amount) * 1e6).toString(); // Assuming 6 decimals
    if (BigInt(amountInSmallestUnits) > BigInt(currentParticipant.balance)) {
      setError('Insufficient balance');
      return;
    }

    if (!userId) {
      setError('User ID not found');
      return;
    }

    setLoading(true);

    try {
      const response = await lightningNodeApi.transferFunds({
        userId,
        appSessionId: lightningNode.appSessionId,
        fromAddress: currentParticipant.address,
        toAddress: selectedRecipient,
        amount: amountInSmallestUnits,
        asset: lightningNode.token,
      });

      if (response.ok) {
        setSuccess(true);

        // Notify parent to refresh data
        if (onTransferComplete) {
          onTransferComplete();
        }

        // Close modal after 1.5 seconds
        setTimeout(() => {
          onOpenChange(false);
        }, 1500);
      } else {
        setError('Transfer failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  const currentBalance = currentParticipant
    ? (Number(currentParticipant.balance) / 1e6).toFixed(2)
    : '0.00';

  const selectedRecipientData = lightningNode.participants.find(
    p => p.address === selectedRecipient
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-black/90 text-white shadow-2xl backdrop-blur w-full max-w-[360px] p-6 rounded-2xl [&>button]:text-white [&>button]:hover:text-white [&>button]:hover:bg-white/20 [&>button]:opacity-100">
        <DialogHeader className="space-y-3">
          <DialogTitle className="text-xl font-rubik-medium text-white flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-gray-400" />
            Transfer Funds
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-sm leading-relaxed">
            Send funds instantly to another participant. Instant and gasless.
          </DialogDescription>
        </DialogHeader>

        {!success ? (
          <div className="space-y-4 mt-4">
            {/* Current Balance */}
            {/* Current Balance */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1">Your Balance</p>
              <p className="text-xl font-rubik-medium text-white">
                {currentBalance} <span className="text-sm text-gray-400 font-normal">{lightningNode.token}</span>
              </p>
            </div>

            {/* Recipient Selector */}
            <div className="space-y-2">
              <Label htmlFor="recipient" className="text-sm font-medium text-white">
                Recipient
              </Label>
              <Select value={selectedRecipient} onValueChange={setSelectedRecipient}>
                <SelectTrigger id="recipient" className="bg-white/5 border-white/10 text-white rounded-xl h-10">
                  <SelectValue placeholder="Select recipient" />
                </SelectTrigger>
                <SelectContent className="bg-black/95 border-white/10 text-white backdrop-blur-xl">
                  {otherParticipants.map(participant => (
                    <SelectItem key={participant.address} value={participant.address} className="focus:bg-white/10 focus:text-white">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-[10px]">
                          {participant.address.slice(0, 10)}...{participant.address.slice(-8)}
                        </span>
                        <span className="text-[10px] text-gray-500">
                          Balance: {(Number(participant.balance) / 1e6).toFixed(2)}{' '}
                          {lightningNode.token}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRecipientData && (
                <p className="text-[10px] text-gray-500 px-1">
                  Available: {(Number(selectedRecipientData.balance) / 1e6).toFixed(2)} {lightningNode.token}
                </p>
              )}
            </div>

            {/* Amount Input */}
            <div className="space-y-3">
              <div className="flex justify-between items-center px-1">
                <Label htmlFor="amount" className="text-sm font-medium text-white">Amount</Label>
                <span className="text-xs text-gray-500">Available: {currentBalance}</span>
              </div>
              <Input
                id="amount"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                step="0.01"
                min="0"
                max={currentBalance}
                className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:border-blue-500/50 focus:ring-blue-500/20 rounded-xl h-12 text-lg font-rubik-medium"
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-200 text-xs">
                <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            {/* Info Message */}
            <div className="p-3 bg-white/5 border border-white/10 rounded-xl text-[10px] text-gray-400 leading-relaxed">
              <strong>Note:</strong> Transfers within a Lightning Node are instant and completely
              off-chain. No gas fees required!
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-8">
            <div className="flex items-center justify-center text-green-400">
              <CheckCircle2 className="h-12 w-12" />
            </div>
            <p className="text-center font-medium text-white">Transfer Successful!</p>
            <p className="text-center text-sm text-gray-400">
              {amount} {lightningNode.token} transferred instantly
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
                onClick={handleTransfer}
                disabled={loading || !selectedRecipient || !amount}
                className="w-full sm:flex-[2] bg-white text-black hover:bg-gray-200 transition-all rounded-xl h-12 font-medium"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    Transfer
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

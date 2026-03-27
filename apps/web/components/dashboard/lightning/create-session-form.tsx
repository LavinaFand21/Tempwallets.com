'use client';

import { useState, useEffect } from 'react';
import { Loader2, Zap, X, Plus } from 'lucide-react';
import { Button } from '@repo/ui/components/ui/button';
import { Input } from '@repo/ui/components/ui/input';
import { Label } from '@repo/ui/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/ui/select';
import { ASSETS, DEFAULT_ASSET, EVM_ADDRESS_REGEX } from './lightning-constants';
import { FieldError } from './field-error';

interface CreateSessionFormProps {
  walletAddress: string | null;
  userId: string;
  chain: string;
  onCreated: (sessionId: string) => void;
  creating: boolean;
  onCreate: (params: {
    participants: string[];
    token: string;
    initialAllocations: { participant: string; amount: string }[];
  }) => Promise<string | null>;
}

export function CreateSessionForm({
  walletAddress,
  userId,
  chain,
  onCreated,
  creating,
  onCreate,
}: CreateSessionFormProps) {
  const [token, setToken] = useState(DEFAULT_ASSET);
  const [extraParticipants, setExtraParticipants] = useState<string[]>(['']);
  const [allocations, setAllocations] = useState<{ address: string; amount: string }[]>([
    { address: walletAddress ?? '', amount: '' },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (walletAddress) {
      setAllocations((prev) => {
        const next = [...prev];
        next[0] = { address: walletAddress, amount: next[0]?.amount ?? '' };
        return next;
      });
    }
  }, [walletAddress]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    allocations.forEach((a, i) => {
      if (!a.amount || Number(a.amount) < 0) {
        errs[`alloc_${i}`] = 'Amount must be ≥ 0';
      }
    });
    extraParticipants.forEach((addr, i) => {
      if (addr && !EVM_ADDRESS_REGEX.test(addr.trim())) {
        errs[`addr_${i}`] = 'Invalid EVM address (0x + 40 hex chars)';
      }
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleAddParticipant = () => {
    setExtraParticipants((prev) => [...prev, '']);
    setAllocations((prev) => [...prev, { address: '', amount: '' }]);
  };

  const handleRemoveParticipant = (idx: number) => {
    setExtraParticipants((prev) => prev.filter((_, i) => i !== idx));
    setAllocations((prev) => prev.filter((_, i) => i !== idx + 1));
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    const allParticipants = [
      walletAddress ?? '',
      ...extraParticipants.map((a) => a.trim()).filter(Boolean),
    ];

    const initialAllocations = allocations
      .filter((a) => a.address)
      .map((a) => ({ participant: a.address, amount: a.amount || '0' }));

    const id = await onCreate({
      participants: allParticipants,
      token,
      initialAllocations,
    });

    if (id) onCreated(id);
  };

  return (
    <div className="space-y-4">
      <div className="bg-[#161616] border border-white/10 rounded-lg p-2.5 text-[11px] text-gray-200">
        <p className="font-medium mb-0.5">How sessions work</p>
        <p>
          Create a session to enable instant off-chain transfers. Funds come from your
          unified balance. Sessions use Judge governance (creator controls signing).
        </p>
      </div>

      <div>
        <Label className="text-xs text-gray-300">
          Token <span className="text-red-500">*</span>
        </Label>
        <Select value={token} onValueChange={setToken}>
          <SelectTrigger className="h-8 text-sm mt-1 bg-[#161616] border-white/10 text-gray-100">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#161616] text-gray-100 border-white/10">
            {ASSETS.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs text-gray-200">Participants &amp; Allocations</Label>
          <button
            type="button"
            onClick={handleAddParticipant}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>

        <div className="space-y-2">
          <div className="bg-[#161616] border border-white/10 rounded-lg p-2 space-y-1.5">
            <p className="text-[10px] text-gray-500 font-medium">You (creator)</p>
            <div className="flex items-center gap-2">
              <Input
                value={walletAddress ?? ''}
                disabled
                className="h-7 text-xs bg-[#161616] border-white/10 text-gray-200 font-mono flex-1"
              />
              <Input
                type="number"
                min="0"
                step="any"
                placeholder="0.00"
                value={allocations[0]?.amount ?? ''}
                onChange={(e) => {
                  setAllocations((prev) => {
                    const next = [...prev];
                    next[0] = { address: next[0]?.address ?? '', amount: e.target.value };
                    return next;
                  });
                }}
                className="h-7 text-xs bg-[#161616] border-white/10 text-white w-24"
              />
            </div>
            <FieldError msg={errors['alloc_0'] ?? null} />
          </div>

          {extraParticipants.map((addr, i) => (
            <div key={i} className="bg-[#161616] border border-white/10 rounded-lg p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-gray-500 font-medium">
                  Participant {i + 2}
                </p>
                <button
                  type="button"
                  onClick={() => handleRemoveParticipant(i)}
                  className="text-gray-400 hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <Input
                placeholder="0x..."
                value={addr}
                onChange={(e) => {
                  setExtraParticipants((prev) => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  });
                  setAllocations((prev) => {
                    const next = [...prev];
                    next[i + 1] = { address: e.target.value, amount: next[i + 1]?.amount ?? '' };
                    return next;
                  });
                }}
                className="h-7 text-xs font-mono bg-[#161616] border-white/10 text-white"
              />
              <FieldError msg={errors[`addr_${i}`] ?? null} />
              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-gray-400 whitespace-nowrap">
                  Allocation:
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={allocations[i + 1]?.amount ?? ''}
                  onChange={(e) => {
                    setAllocations((prev) => {
                      const next = [...prev];
                      next[i + 1] = { address: next[i + 1]?.address ?? '', amount: e.target.value };
                      return next;
                    });
                  }}
                  className="h-7 text-xs bg-[#161616] border-white/10 text-white w-24"
                />
              </div>
              <FieldError msg={errors[`alloc_${i + 1}`] ?? null} />
            </div>
          ))}
        </div>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={creating}
        className="w-full bg-yellow-400 hover:bg-yellow-500 text-black"
      >
        {creating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Creating…
          </>
        ) : (
          <>
            <Zap className="h-4 w-4 mr-2" />
            Create Session
          </>
        )}
      </Button>
    </div>
  );
}

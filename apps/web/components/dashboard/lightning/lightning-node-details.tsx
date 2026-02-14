'use client';

import { QRCodeCanvas } from 'qrcode.react';

import { useState, useEffect } from 'react';
import { Loader2, Zap, Copy, ArrowRightLeft, Plus, Minus, Wallet, X, ChevronDown, ChevronUp, QrCode } from 'lucide-react';
import { Button } from '@repo/ui/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@repo/ui/components/ui/tooltip';
import { lightningNodeApi, LightningNode, LightningNodeParticipant, walletApi } from '@/lib/api';
import { TransferFundsModal } from '../modals/transfer-funds-modal';
import { DepositFundsModal } from '../modals/deposit-funds-modal';
import { WithdrawFundsModal } from '../modals/withdraw-funds-modal';
import { FundChannelModal } from '../modals/fund-channel-modal';
import { LightningNodeQrModal } from '../modals/lightning-node-qr-modal';
import { useAuth } from '@/hooks/useAuth';

interface LightningNodeDetailsProps {
  lightningNodeId: string;
  onClose?: () => void;
}

const CHAIN_NAMES: Record<string, string> = {
  ethereum: 'Ethereum',
  ethereumErc4337: 'Ethereum Gasless',
  base: 'Base',
  baseErc4337: 'Base Gasless',
  arbitrum: 'Arbitrum',
  arbitrumErc4337: 'Arbitrum Gasless',
  polygon: 'Polygon',
  polygonErc4337: 'Polygon Gasless',
  sepolia: 'Sepolia Testnet',
};

export function LightningNodeDetails({ lightningNodeId, onClose }: LightningNodeDetailsProps) {
  const { userId } = useAuth();
  const [lightningNode, setLightningNode] = useState<LightningNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userAddressSet, setUserAddressSet] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);
  const [fundChannelModalOpen, setFundChannelModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [showParticipants, setShowParticipants] = useState(true);
  const [showTransactions, setShowTransactions] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);

  // Best-effort presence heartbeat for this node.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    if (!userId || !lightningNode?.appSessionId) return;

    const sendHeartbeat = async () => {
      try {
        await lightningNodeApi.heartbeatLightningNode(lightningNode.appSessionId, userId);
      } catch {
        // Non-critical
      }
    };

    // Kick immediately, then every 30s while the details view is open.
    void sendHeartbeat();
    timer = setInterval(sendHeartbeat, 30_000);

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [userId, lightningNode?.appSessionId]);

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
        // Best-effort: if this fails, UI falls back to showing 0 balance and disables actions.
        if (!cancelled) setUserAddressSet(new Set());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Fetch Lightning Node details
  useEffect(() => {
    const fetchDetails = async () => {
      setLoading(true);
      setError(null);

      // Handle mock data for development
      if (lightningNodeId === 'mock-node-1') {
        const MOCK_NODE: LightningNode = {
          id: 'mock-node-1',
          userId: 'mock-user-1',
          appSessionId: 'ln_session_mock_123',
          uri: 'lightning://ln_session_mock_123@tempwallets.com',
          chain: 'ethereum',
          token: 'USDC',
          status: 'open',
          maxParticipants: 10,
          quorum: 1,
          protocol: 'NitroRPC/0.4',
          challenge: 12345,
          sessionData: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          closedAt: null,
          participants: [
            {
              id: 'mock-participant-1',
              address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
              weight: 100,
              balance: '500000000', // 500 USDC
              asset: 'USDC',
              status: 'joined',
              joinedAt: new Date().toISOString(),
              lastSeenAt: new Date().toISOString(),
              leftAt: null,
            },
          ],
        };
        setTimeout(() => {
          setLightningNode(MOCK_NODE);
          setLoading(false);
        }, 300); // Small delay for "realism"
        return;
      }

      try {
        const response = await lightningNodeApi.getLightningNodeById(lightningNodeId);
        if (response.ok && response.node) {
          setLightningNode(response.node);
        } else {
          setError('Failed to load Lightning Node details');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load Lightning Node details');
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [lightningNodeId]);

  const handleCopySessionId = () => {
    if (lightningNode) {
      navigator.clipboard.writeText(lightningNode.appSessionId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const handleCopyUri = () => {
    if (lightningNode) {
      navigator.clipboard.writeText(lightningNode.uri);
      setCopiedUri(true);
      setTimeout(() => setCopiedUri(false), 2000);
    }
  };


  const refreshDetails = async () => {
    try {
      const response = await lightningNodeApi.getLightningNodeById(lightningNodeId);
      if (response.ok && response.node) {
        setLightningNode(response.node);
      }
    } catch (err) {
      console.error('Failed to refresh details:', err);
    }
  };

  // Loading state
  if (loading && !lightningNode) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-4" />
        <p className="text-gray-500 font-rubik-normal">Loading Lightning Node...</p>
      </div>
    );
  }

  // Error state
  if (error && !lightningNode) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="text-red-500 mb-4">⚠️</div>
        <p className="text-gray-600 text-lg font-rubik-medium mb-2">Failed to load details</p>
        <p className="text-gray-500 text-sm">{error}</p>
        {onClose && (
          <Button onClick={onClose} className="mt-4" variant="outline">
            Go Back
          </Button>
        )}
      </div>
    );
  }

  if (!lightningNode) return null;

  const totalBalance = lightningNode.participants.reduce(
    (sum, p) => sum + BigInt(p.balance),
    BigInt(0)
  );
  const balanceHuman = (Number(totalBalance) / 1e6).toFixed(2);
  const participantCount = lightningNode.participants.length;
  const currentParticipant = lightningNode.participants.find(
    (p) => userAddressSet.has(p.address.toLowerCase())
  ) || (lightningNode.id === 'mock-node-1' ? lightningNode.participants[0] : null);
  const myBalance = currentParticipant ? (Number(currentParticipant.balance) / 1e6).toFixed(2) : '0.00';

  return (
    <div className="bg-white rounded-3xl p-3 border border-gray-100 shadow-sm">
      <div className="space-y-4">
        {/* Network Bar Header */}
        <div className="bg-gray-50 rounded-xl p-3 border border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white p-2 rounded-lg border border-gray-100 shadow-sm">
              <Zap className="h-5 w-5 text-gray-700 fill-gray-100" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Network</p>
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                {CHAIN_NAMES[lightningNode.chain] || lightningNode.chain}
                <span className="text-gray-300">|</span>
                {lightningNode.token}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* QR Code Toggle */}
            {lightningNode.status === 'open' && (
              <TooltipProvider>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setQrModalOpen(true)}
                      className="p-2 rounded-lg transition-all border border-transparent hover:bg-white hover:border-gray-200 text-gray-500 hover:text-gray-700"
                    >
                      <QrCode className="h-5 w-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Show QR Code</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Close Button */}
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-white hover:border-gray-200 border border-transparent rounded-lg transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {/* Status and Balance Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 overflow-hidden">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">My Balance</p>
            <p className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 tracking-tight whitespace-nowrap overflow-hidden text-ellipsis flex items-baseline gap-1.5">
              <span>{myBalance}</span>
              <span className="text-sm sm:text-base md:text-xl font-medium text-gray-500">{lightningNode.token}</span>
            </p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 overflow-hidden">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Total Balance</p>
            <p className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 tracking-tight whitespace-nowrap overflow-hidden text-ellipsis flex items-baseline gap-1.5">
              <span>{balanceHuman}</span>
              <span className="text-sm sm:text-base md:text-xl font-medium text-gray-500">{lightningNode.token}</span>
            </p>
          </div>
        </div>

        {/* Session ID */}
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Session ID</p>
            <button
              onClick={handleCopySessionId}
              className="text-xs text-gray-700 hover:text-gray-900 flex items-center gap-1"
            >
              <Copy className="h-3 w-3" />
              {copiedId ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-xs font-mono text-gray-500 break-all">{lightningNode.appSessionId}</p>
        </div>



        {/* QR Code Modal handled by Header Icon */}
        <LightningNodeQrModal
          open={qrModalOpen}
          onOpenChange={setQrModalOpen}
          uri={lightningNode.uri}
          chain={CHAIN_NAMES[lightningNode.chain] || lightningNode.chain}
          token={lightningNode.token}
        />

        {/* Action Buttons */}
        {lightningNode.status === 'open' && currentParticipant && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDepositModalOpen(true)}
                className="border-blue-100/50 text-blue-600 bg-blue-50/30 hover:bg-blue-50 hover:border-blue-200 transition-all rounded-full h-10 text-xs font-medium"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Deposit
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => setTransferModalOpen(true)}
                className="border-gray-100/50 text-gray-600 bg-gray-50/30 hover:bg-gray-50 hover:border-gray-200 transition-all rounded-full h-10 text-xs font-medium"
              >
                <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
                Transfer
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => setWithdrawModalOpen(true)}
                className="border-orange-100/50 text-orange-600 bg-orange-50/30 hover:bg-orange-50 hover:border-orange-200 transition-all rounded-full h-10 text-xs font-medium"
              >
                <Minus className="mr-1.5 h-3.5 w-3.5" />
                Withdraw
              </Button>
            </div>

          </div>
        )}

        {/* Participants Section */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            onClick={() => setShowParticipants(!showParticipants)}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
          >
            <h3 className="font-rubik-medium text-gray-900">
              Participants ({participantCount}/{lightningNode.maxParticipants})
            </h3>
            {showParticipants ? (
              <ChevronUp className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            )}
          </button>

          {showParticipants && (
            <div className="border-t border-gray-200">
              {lightningNode.participants.map((participant, index) => (
                <div
                  key={participant.address}
                  className={`p-4 flex items-center justify-between ${index !== lightningNode.participants.length - 1 ? 'border-b border-gray-100' : ''
                    }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm text-gray-900">
                        {participant.address.slice(0, 10)}...{participant.address.slice(-8)}
                      </p>
                      {participant.address === userId && (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                          You
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      Weight: {participant.weight}% |{' '}
                      {participant.status === 'invited' ? (
                        'Invited'
                      ) : participant.joinedAt ? (
                        <>Joined {new Date(participant.joinedAt).toLocaleDateString()}</>
                      ) : (
                        'Joined'
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-rubik-medium text-gray-900">
                      {(Number(participant.balance) / 1e6).toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500">{lightningNode.token}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transactions Section */}
        {lightningNode.transactions && lightningNode.transactions.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <button
              onClick={() => setShowTransactions(!showTransactions)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
            >
              <h3 className="font-rubik-medium text-gray-900">
                Transactions ({lightningNode.transactions.length})
              </h3>
              {showTransactions ? (
                <ChevronUp className="h-5 w-5 text-gray-400" />
              ) : (
                <ChevronDown className="h-5 w-5 text-gray-400" />
              )}
            </button>

            {showTransactions && (
              <div className="border-t border-gray-200">
                {lightningNode.transactions.map((tx, index) => (
                  <div
                    key={tx.id}
                    className={`p-4 ${index !== lightningNode.transactions!.length - 1 ? 'border-b border-gray-100' : ''
                      }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                        {tx.type}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${tx.status === 'confirmed'
                          ? 'bg-green-100 text-green-700'
                          : tx.status === 'pending'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                          }`}
                      >
                        {tx.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-600">
                        <p className="font-mono">
                          {tx.from.slice(0, 8)}... → {tx.to.slice(0, 8)}...
                        </p>
                        <p className="text-gray-400">
                          {new Date(tx.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <p className="font-rubik-medium text-gray-900">
                        {(Number(tx.amount) / 1e6).toFixed(2)} {tx.asset}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {currentParticipant && (
        <>
          {/* Fund Channel Modal (On-Chain) */}
          <FundChannelModal
            open={fundChannelModalOpen}
            onOpenChange={setFundChannelModalOpen}
            chain={lightningNode.chain}
            asset={lightningNode.token}
            onFundComplete={refreshDetails}
          />

          {/* Deposit Modal */}
          <DepositFundsModal
            open={depositModalOpen}
            onOpenChange={setDepositModalOpen}
            lightningNode={lightningNode}
            onDepositComplete={refreshDetails}
          />

          {/* Transfer Modal */}
          <TransferFundsModal
            open={transferModalOpen}
            onOpenChange={setTransferModalOpen}
            lightningNode={lightningNode}
            onTransferComplete={refreshDetails}
          />

          {/* Withdraw Modal */}
          <WithdrawFundsModal
            open={withdrawModalOpen}
            onOpenChange={setWithdrawModalOpen}
            lightningNode={lightningNode}
            onWithdrawComplete={refreshDetails}
          />
        </>
      )}
    </div>
  );
}

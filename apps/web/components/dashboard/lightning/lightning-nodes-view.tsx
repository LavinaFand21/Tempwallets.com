'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Loader2, Zap, Copy, ChevronRight, Mail, CheckCircle2, AlertCircle, Plus } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@repo/ui/components/ui/tooltip';
import { useLightningNodes } from '@/hooks/lightning-nodes-context';
import { CreateLightningNodeModal } from './create-lightning-node-modal';
import { LightningNodeDetails } from './lightning-node-details';
import { FundChannelModal } from '../modals/fund-channel-modal';
import { LightningNode } from '@/lib/api';

const LAST_SELECTED_LN_NODE_ID_KEY = 'tempwallets:lastSelectedLightningNodeId';

const CHAIN_NAMES: Record<string, string> = {
  ethereum: 'Ethereum',
  ethereumErc4337: 'Ethereum Gasless',
  base: 'Base',
  baseErc4337: 'Base Gasless',
  arbitrum: 'Arbitrum',
  arbitrumErc4337: 'Arbitrum Gasless',
  polygon: 'Polygon',
  polygonErc4337: 'Polygon Gasless',
};

/**
 * Authentication Status Banner Component
 * Shows wallet authentication status at the top
 */
const AuthenticationStatus = ({
  authenticated,
  authenticating,
  error,
  onRetry,
}: {
  authenticated: boolean;
  authenticating: boolean;
  error: string | null;
  onRetry: () => void;
}) => {
  if (authenticating || (!authenticated && !error)) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2 mb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          <div>
            <p className="text-sm font-rubik-medium text-blue-900">Wallet Authentication in process</p>
            <p className="text-xs text-blue-700">Connecting to Yellow Network...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !authenticated) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 mb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-600" />
          <div>
            <p className="text-sm font-rubik-medium text-red-900">Wallet Authentication failed</p>
            <p className="text-xs text-red-700">Please try again</p>
          </div>
        </div>
        <button
          onClick={onRetry}
          className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (authenticated) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2 mb-2 flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        <div>
          <p className="text-sm font-rubik-medium text-green-900">Wallet Authentication successful</p>
          <p className="text-xs text-green-700">Connected to Yellow Network</p>
        </div>
      </div>
    );
  }

  return null;
};

// Join search input removed; join is now inside the Create modal.

/**
 * Lightning Node Card Component
 * Displays information about a single Lightning Node
 */
function LightningNodeCard({
  node,
  onClick,
  isInvitation = false,
}: {
  node: LightningNode;
  onClick?: () => void;
  isInvitation?: boolean;
}) {
  const [copiedId, setCopiedId] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);

  const handleCopyChannelId = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(node.appSessionId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleCopyUri = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(node.uri);
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 2000);
  };

  const participantCount = node.participants.length;
  const totalBalance = node.participants.reduce((sum, p) => sum + BigInt(p.balance), BigInt(0));
  const balanceHuman = (Number(totalBalance) / 1e6).toFixed(2);

  const statusColor = 'bg-gray-200 text-gray-800';

  const statusText = {
    open: 'Open',
    closed: 'Closed',
  }[node.status] || 'Unknown';

  return (
    <div
      className={`bg-white rounded-2xl p-4 space-y-3 border transition-colors cursor-pointer group ${isInvitation
        ? 'border-gray-200 hover:border-gray-300'
        : 'border-gray-200 hover:border-gray-300'
        }`}
      onClick={onClick}
    >
      {/* Header with Status */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-gray-100">
            {isInvitation ? (
              <Mail className="h-5 w-5 text-gray-700" />
            ) : (
              <Zap className="h-5 w-5 text-gray-700" />
            )}
          </div>
          <div>
            <h3 className="font-rubik-medium text-gray-900">
              {CHAIN_NAMES[node.chain] || node.chain}
            </h3>
            <p className="text-sm text-gray-500">{node.token}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColor}`}>
            {statusText}
          </span>
          {isInvitation && (
            <span className="text-xs text-gray-700 font-medium">New Invitation</span>
          )}
        </div>
      </div>

      {/* Balance */}
      <div className="bg-gray-50 rounded-xl p-3">
        <p className="text-xs text-gray-500 mb-1">Total Channel Balance</p>
        <p className="text-lg font-rubik-medium text-gray-900">
          {balanceHuman} {node.token}
        </p>
      </div>

      {/* Participants */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600">Participants</span>
        <span className="font-rubik-medium text-gray-900">
          {participantCount} / {node.maxParticipants}
        </span>
      </div>

      {/* App Session ID */}
      <div className="bg-gray-50 rounded-xl p-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-gray-500">Session ID</p>
          <button
            onClick={handleCopyChannelId}
            className="text-xs text-gray-700 hover:text-gray-900 flex items-center gap-1"
          >
            <Copy className="h-3 w-3" />
            {copiedId ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="text-xs font-mono text-gray-700 break-all">
          {node.appSessionId}
        </p>
      </div>

      {/* Lightning URI (for sharing) */}
      {node.status === 'open' && participantCount < node.maxParticipants && (
        <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-700 font-medium">Share this link</p>
            <button
              onClick={handleCopyUri}
              className="text-xs text-gray-700 hover:text-gray-900 flex items-center gap-1"
            >
              <Copy className="h-3 w-3" />
              {copiedUri ? 'Copied!' : 'Copy URI'}
            </button>
          </div>
          <p className="text-xs font-mono text-gray-700 break-all">
            {node.uri}
          </p>
        </div>
      )}

      {/* View Details */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">
          Created {new Date(node.createdAt).toLocaleDateString()}
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-700 group-hover:text-black">
          <span>{isInvitation ? 'View Invitation' : 'View Details'}</span>
          <ChevronRight className="h-3 w-3" />
        </div>
      </div>
    </div>
  );
}

/**
 * Lightning Nodes View Component
 * Main dashboard view with authentication, invitations, search, and active sessions
 */
export function LightningNodesView() {
  const {
    authenticated = false,
    authenticating = false,
    walletAddress,
    allSessions,
    activeSessions,
    invitations,
    searchSession,
    authenticate,
    discoverSessions,
    loading,
    error,
  } = useLightningNodes();

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [fundChannelModalOpen, setFundChannelModalOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // OPTIMIZATION: On-demand authentication and session discovery
  // Trigger authentication when component mounts (user navigates to Lightning section)
  useEffect(() => {
    const initializeLightningNodes = async () => {
      if (!authenticated && !authenticating) {
        console.log('[LightningNodesView] User navigated to Lightning section - initializing...');
        await authenticate('base');

        // After authentication, fetch sessions
        await discoverSessions('base');
      } else if (authenticated && allSessions.length === 0 && !loading) {
        // Already authenticated but no sessions loaded yet
        console.log('[LightningNodesView] Authenticated but no sessions loaded - fetching...');
        await discoverSessions('base');
      }
    };

    initializeLightningNodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Restore last-opened node after refresh
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LAST_SELECTED_LN_NODE_ID_KEY);
      if (saved) setSelectedNodeId(saved);
    } catch {
      // ignore (SSR / privacy mode)
    }
  }, []);

  // Persist selection
  useEffect(() => {
    try {
      if (selectedNodeId) {
        window.localStorage.setItem(LAST_SELECTED_LN_NODE_ID_KEY, selectedNodeId);
      } else {
        window.localStorage.removeItem(LAST_SELECTED_LN_NODE_ID_KEY);
      }
    } catch {
      // ignore
    }
  }, [selectedNodeId]);

  // Deep link handling - auto-search if session param is present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');

    if (sessionParam && authenticated && !selectedNodeId) {
      console.log('[Lightning] Deep link detected:', sessionParam);
      handleSearch(sessionParam);

      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [authenticated, selectedNodeId]);

  const handleSearch = async (sessionId: string) => {
    setSearchError(null);

    try {
      const node = await searchSession(sessionId);
      if (node) {
        setSelectedNodeId(node.id);
      } else {
        setSearchError('Session not found or you are not a participant');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to search for session';
      setSearchError(errorMessage);
    }
  };

  // Show Lightning Node details if one is selected
  if (selectedNodeId) {
    return (
      <LightningNodeDetails
        lightningNodeId={selectedNodeId}
        onClose={() => setSelectedNodeId(null)}
      />
    );
  }

  const handleRetry = async () => {
    // Retry authentication
    await authenticate('base');
  };

  // Show loading state while authenticating (Initial full-screen loader can be removed or kept minimal if desired, 
  // but user requested "Auth in process" section in empty state mostly).
  // Keeping this block for now if it's the very first load, but maybe we can relax it to show empty state earlier?
  // User asked: "before clicking on create/join at that meantime it should show Wallet Authentication in process"
  if (authenticating && !authenticated && !error) {
    // If we want to show the empty state structure immediately even during auth, we should skip this return.
    // However, if we skip this, we need to ensure 'loading' doesn't block rendering.
    // Let's rely on the AuthenticationStatus component inside the Empty State view instead.
  }

  const safeActiveSessions = activeSessions || [];
  const safeInvitations = invitations || [];
  const hasAnySessions = safeActiveSessions.length > 0 || safeInvitations.length > 0;

  // Show empty state if no sessions
  if (!hasAnySessions) {
    return (
      <>
        {/* Empty State */}
        <div className="flex flex-col items-center justify-center py-2 relative">
          <div className="w-full max-w-2xl mx-auto z-10">
            <AuthenticationStatus
              authenticated={authenticated}
              authenticating={authenticating}
              error={error}
              onRetry={handleRetry}
            />
          </div>

          <div className="-mt-4">
            <Image
              src="/empty-mailbox-illustration-with-spiderweb-and-flie-2025-10-20-04-28-09-utc.gif"
              alt="No Lightning Nodes"
              width={320}
              height={320}
              className="object-contain mix-blend-multiply"
            />
          </div>

          <p className="text-gray-600 text-lg md:text-xl font-rubik-medium z-10 -mt-2 mb-4 text-center px-4">
            No Lightning Nodes Available
          </p>
          <p className="text-sm text-gray-500 mb-6 text-center px-4">
            Create or join a Lightning Node to get started.
          </p>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="bg-black text-white px-6 py-3 rounded-xl font-rubik-medium hover:bg-gray-800 transition-colors flex items-center gap-2 shadow-lg shadow-gray-300/50 border border-gray-300 active:scale-[0.99]"
          >
            <Zap className="h-4 w-4" />
            Create / Join Lightning Node
          </button>
        </div>

        <CreateLightningNodeModal
          open={createModalOpen}
          onOpenChange={setCreateModalOpen}
          onJoined={(node) => {
            setSelectedNodeId(node.id);
          }}
        />

        <FundChannelModal
          open={fundChannelModalOpen}
          onOpenChange={setFundChannelModalOpen}
          chain="base"
          asset="usdc"
          onFundComplete={() => {
            // Optionally refresh data after funding
          }}
        />
      </>
    );
  }

  // Show list of Lightning Nodes
  return (
    <>
      {/* Authentication Banner */}
      <AuthenticationStatus
        authenticated={authenticated}
        authenticating={authenticating}
        error={error}
        onRetry={handleRetry}
      />

      <div className="space-y-6">
        {/* New Invitations Section */}
        {safeInvitations.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-rubik-medium text-gray-900">
                  New Invitations
                </h2>
                <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-1 rounded-full">
                  {safeInvitations.length}
                </span>
              </div>
            </div>
            <div className="space-y-3">
              {safeInvitations.map((node) => (
                <LightningNodeCard
                  key={node.appSessionId}
                  node={node}
                  onClick={() => setSelectedNodeId(node.id)}
                  isInvitation={true}
                />
              ))}
            </div>
          </div>
        )}

        {/* Active Sessions Section */}
        {safeActiveSessions.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-gray-700" />
                <h2 className="text-base sm:text-lg font-rubik-medium text-gray-900">
                  My Lightning Nodes
                  <span className="ml-2 bg-gray-100 text-gray-700 text-[10px] sm:text-xs font-medium px-2 py-1 rounded-full">
                    {safeActiveSessions.length}
                  </span>
                </h2>
              </div>
              <button
                onClick={() => setCreateModalOpen(true)}
                className="bg-black text-white px-4 py-2 rounded-xl font-rubik-medium hover:bg-gray-800 transition-colors flex items-center gap-2 text-sm shadow-lg shadow-gray-300/50 border border-gray-300 active:scale-[0.99]"
              >
                <Zap className="h-4 w-4" />
                Create / Join
              </button>
            </div>
            <div className="space-y-3">
              {safeActiveSessions.map((node) => (
                <LightningNodeCard
                  key={node.appSessionId}
                  node={node}
                  onClick={() => setSelectedNodeId(node.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <CreateLightningNodeModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onJoined={(node) => {
          setSelectedNodeId(node.id);
          setCreateModalOpen(false);
        }}
      />

      <FundChannelModal
        open={fundChannelModalOpen}
        onOpenChange={setFundChannelModalOpen}
        chain="base"
        asset="usdc"
        onFundComplete={() => {
          // Optionally refresh data after funding
        }}
      />
    </>
  );
}

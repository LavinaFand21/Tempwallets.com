'use client';

/**
 * WalletConnect Modal Component
 * 
 * Modal dialog for connecting to Polkadot dapps via WalletConnect/Reown
 * Features a prominent QR scanner that starts automatically
 */

import { useState, useEffect, useRef } from 'react';
import { useSubstrateWalletConnect } from '@/hooks/useSubstrateWalletConnect';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@repo/ui/components/ui/dialog';
import { Html5Qrcode } from 'html5-qrcode';

interface WalletConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WalletConnectModal({ open, onOpenChange }: WalletConnectModalProps) {
  // Use authenticated user ID (Google user) or fallback to fingerprint
  const { userId } = useAuth();
  const {
    isInitializing,
    sessions,
    pair,
    disconnect,
    initialize
  } = useSubstrateWalletConnect(userId);

  const [uriInput, setUriInput] = useState('');
  const [isPairing, setIsPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);

  // Initialize WalletConnect when modal opens (runs in background)
  // Only initialize if not already initializing or initialized
  useEffect(() => {
    if (open && userId && !isInitializing) {
      initialize().catch((err) => {
        console.error('Failed to initialize WalletConnect:', err);
      });
    }
  }, [open, userId, initialize, isInitializing]);

  // Cleanup scanner on unmount or when modal closes
  useEffect(() => {
    if (!open) {
      stopScanner();
      setUriInput('');
      setPairError(null);
      setCameraError(null);
      setShowScanner(false);
    }
  }, [open]);

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current
        .stop()
        .then(() => {
          scannerRef.current = null;
          setIsScanning(false);
        })
        .catch((err) => {
          console.error('Failed to stop scanner:', err);
          scannerRef.current = null;
          setIsScanning(false);
        });
    }
  };

  // Start scanner when user clicks the button
  const handleStartScanner = () => {
    // Only start scanner if WalletConnect is ready
    if (isInitializing) {
      console.warn('WalletConnect is still initializing, please wait...');
      return;
    }

    setShowScanner(true);
    setCameraError(null);
    // Small delay to ensure DOM element exists
    setTimeout(() => {
      startScanner();
    }, 50);
  };

  const startScanner = async () => {
    if (!scannerContainerRef.current || scannerRef.current) return;

    try {
      setCameraError(null);
      setIsScanning(false);

      const html5QrCode = new Html5Qrcode('walletconnect-scanner', {
        verbose: false,
      });
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          if (decodedText.startsWith('wc:')) {
            setUriInput(decodedText);
            stopScanner();
            handleConnect(decodedText);
          }
        },
        () => { }
      );

      setIsScanning(true);
      setCameraError(null);
    } catch (err: any) {
      console.error('Scanner error:', err);
      scannerRef.current = null;
      setIsScanning(false);

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('Camera access denied. Please allow camera permissions or paste a URL below.');
      } else if (err.name === 'NotFoundError') {
        setCameraError('No camera found. Please paste a WalletConnect URL below.');
      } else {
        setCameraError('Failed to access camera. Please paste a URL below.');
      }
    }
  };

  const handleConnect = async (uri?: string) => {
    const uriToUse = uri || uriInput.trim();

    if (!uriToUse) {
      setPairError('Please enter a WalletConnect URI');
      return;
    }

    if (!uriToUse.startsWith('wc:')) {
      setPairError('Invalid WalletConnect URI');
      return;
    }

    setIsPairing(true);
    setPairError(null);

    try {
      await pair(uriToUse);
      setUriInput('');
      onOpenChange(false);
    } catch (err) {
      console.error('Pairing failed:', err);
      setPairError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsPairing(false);
    }
  };

  const handleDisconnect = async (topic: string) => {
    try {
      await disconnect(topic);
    } catch (err) {
      console.error('Disconnect failed:', err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-full max-w-[360px] p-0 rounded-2xl bg-black/90 border border-white/10 text-white shadow-2xl backdrop-blur overflow-hidden"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Connect DApp via WalletConnect</DialogTitle>
        {isInitializing ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col">
            {/* Header */}
            <div className="text-center pt-6 pb-4">
              <h2 className="text-xl font-semibold text-white">Connect DApp</h2>
            </div>

            {/* QR Scanner */}
            <div className="relative mx-4 mb-4">
              {showScanner ? (
                <>
                  <div
                    id="walletconnect-scanner"
                    ref={scannerContainerRef}
                    className="w-full aspect-square rounded-2xl overflow-hidden bg-black border border-white/10"
                  />
                  {/* Loading state while scanner starts */}
                  {!isScanning && !cameraError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 rounded-2xl">
                      <Loader2 className="h-8 w-8 animate-spin text-white mb-3" />
                      <p className="text-white text-sm">Starting camera...</p>
                    </div>
                  )}
                  {/* Error state if camera fails */}
                  {cameraError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/90 rounded-2xl p-6">
                      <p className="text-white/60 text-center text-sm">{cameraError}</p>
                    </div>
                  )}
                </>
              ) : (
                /* Start Camera Button */
                <button
                  onClick={handleStartScanner}
                  disabled={isInitializing}
                  className="w-full aspect-square rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center group"
                >
                  <span className="text-white/60 group-hover:text-white transition-colors text-sm">
                    {isInitializing ? 'Initializing...' : 'Tap to scan QR code'}
                  </span>
                </button>
              )}
            </div>

            {/* Scan instruction */}
            {showScanner && <p className="text-center text-white/40 text-sm py-4">Scan QR to connect</p>}

            {/* URL Input */}
            <div className="px-4 pb-6">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Or paste WalletConnect URL"
                  value={uriInput}
                  onChange={(e) => {
                    setUriInput(e.target.value);
                    setPairError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && uriInput) {
                      handleConnect();
                    }
                  }}
                  className="w-full px-4 py-3 pr-24 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/40 focus:border-white/40 focus:ring-white/20 text-sm"
                />
                <button
                  onClick={() => handleConnect()}
                  disabled={isPairing || !uriInput.trim() || !userId}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-white text-black hover:bg-white/90 disabled:bg-white/20 disabled:text-white/50 disabled:cursor-not-allowed rounded-full transition-colors text-sm font-medium"
                >
                  {isPairing ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Connecting
                    </span>
                  ) : (
                    "Connect"
                  )}
                </button>
              </div>
              {pairError && (
                <p className="text-sm text-red-400 mt-2 text-center">{pairError}</p>
              )}
            </div>
          </div>
        ) : (
          /* Connected Sessions View */
          <div className="p-6 space-y-4">
            <h2 className="text-xl font-semibold text-white text-center">Connected DApps</h2>

            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3">
              <p className="text-green-400 font-medium text-sm text-center">
                ✅ {sessions.length} active connection{sessions.length > 1 ? 's' : ''}
              </p>
            </div>

            {sessions
              .filter((session) => session && session.topic)
              .map((session) => (
                <div key={session.topic} className="border border-white/10 rounded-xl p-4 bg-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-white truncate">
                        {session.peer?.metadata?.name || 'Unknown DApp'}
                      </h3>
                      {session.peer?.metadata?.url && (
                        <p className="text-sm text-white/60 truncate">
                          {session.peer.metadata.url}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleDisconnect(session.topic)}
                      className="ml-3 p-2 text-white/60 hover:text-red-400 hover:bg-white/5 rounded-xl transition-colors flex-shrink-0"
                      title="Disconnect"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}


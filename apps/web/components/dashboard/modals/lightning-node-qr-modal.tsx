'use client';

import { QRCodeCanvas } from 'qrcode.react';
import { useState } from 'react';
import { Copy, CheckCircle2 } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@repo/ui/components/ui/dialog';
import { Button } from '@repo/ui/components/ui/button';

interface LightningNodeQrModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    uri: string;
    chain: string;
    token: string;
}

export function LightningNodeQrModal({
    open,
    onOpenChange,
    uri,
    chain,
    token,
}: LightningNodeQrModalProps) {
    const [copied, setCopied] = useState(false);

    const handleCopyUri = () => {
        navigator.clipboard.writeText(uri);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="border-white/10 bg-black/90 text-white shadow-2xl backdrop-blur w-full max-w-[360px] p-0 rounded-2xl [&>button]:text-white [&>button]:hover:text-white [&>button]:hover:bg-white/20 [&>button]:opacity-100">
                <DialogHeader className="px-6 pt-5 pb-0">
                    <div className="flex flex-col gap-1.5 text-left">
                        <DialogTitle className="text-lg font-semibold text-white tracking-tight">Node QR Code</DialogTitle>
                        <DialogDescription className="text-xs text-gray-400 font-normal">
                            Scan or copy the URI to share this {chain} {token} node.
                        </DialogDescription>
                    </div>
                </DialogHeader>

                <div className="px-6 py-6 space-y-4">
                    <div className="flex justify-center">
                        <div className="bg-white p-3 rounded-2xl border border-white/10 shadow-lg">
                            <QRCodeCanvas value={uri} size={200} level="H" />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Node URI</p>
                            <button
                                onClick={handleCopyUri}
                                className="text-[10px] font-bold text-blue-400 hover:text-blue-300 uppercase tracking-widest flex items-center gap-1 transition-colors"
                            >
                                {copied ? (
                                    <>
                                        <CheckCircle2 className="h-3 w-3" />
                                        Copied
                                    </>
                                ) : (
                                    <>
                                        <Copy className="h-3 w-3" />
                                        Copy
                                    </>
                                )}
                            </button>
                        </div>
                        <div className="w-full bg-white/5 rounded-xl p-3 border border-white/10">
                            <p className="text-[11px] font-mono text-gray-300 break-all leading-relaxed">
                                {uri}
                            </p>
                        </div>
                    </div>

                    <Button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="w-full bg-white text-black hover:bg-white/90 h-9 text-sm rounded-full font-medium transition-all active:scale-[0.98]"
                    >
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

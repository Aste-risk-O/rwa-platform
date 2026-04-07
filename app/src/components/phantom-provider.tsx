"use client";

import { Buffer } from "buffer";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import type { BrowserWallet } from "@/lib/solana/rwa-client";

type PhantomEvent = "connect" | "disconnect" | "accountChanged";

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: PublicKey | null;
  isConnected?: boolean;
  connect: () => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
  signTransaction: (
    transaction: Transaction | VersionedTransaction
  ) => Promise<Transaction | VersionedTransaction>;
  signAllTransactions: (
    transactions: (Transaction | VersionedTransaction)[]
  ) => Promise<(Transaction | VersionedTransaction)[]>;
  on: (event: PhantomEvent, handler: () => void) => void;
  removeListener: (event: PhantomEvent, handler: () => void) => void;
};

declare global {
  interface Window {
    Buffer?: typeof Buffer;
    phantom?: {
      solana?: PhantomProvider;
    };
    solana?: PhantomProvider;
  }
}

type PhantomContextValue = {
  provider: PhantomProvider | null;
  ready: boolean;
  connected: boolean;
  connecting: boolean;
  publicKey: PublicKey | null;
  wallet: BrowserWallet | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

const PhantomContext = createContext<PhantomContextValue | null>(null);

function getPhantomProvider() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.phantom?.solana ?? window.solana ?? null;
}

export function PhantomWalletProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<PhantomProvider | null>(null);
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    window.Buffer = Buffer;

    const phantom = getPhantomProvider();
    if (!phantom?.isPhantom) {
      return;
    }

    setProvider(phantom);
    setPublicKey(phantom.publicKey ?? null);
    setConnected(Boolean(phantom.isConnected && phantom.publicKey));

    const handleConnect = () => {
      setPublicKey(phantom.publicKey ?? null);
      setConnected(Boolean(phantom.publicKey));
    };

    const handleDisconnect = () => {
      setPublicKey(null);
      setConnected(false);
    };

    const handleAccountChanged = () => {
      setPublicKey(phantom.publicKey ?? null);
      setConnected(Boolean(phantom.publicKey));
    };

    phantom.on("connect", handleConnect);
    phantom.on("disconnect", handleDisconnect);
    phantom.on("accountChanged", handleAccountChanged);

    return () => {
      phantom.removeListener("connect", handleConnect);
      phantom.removeListener("disconnect", handleDisconnect);
      phantom.removeListener("accountChanged", handleAccountChanged);
    };
  }, []);

  const wallet = useMemo<BrowserWallet | null>(() => {
    if (!provider || !publicKey) {
      return null;
    }

    return {
      publicKey,
      signTransaction: provider.signTransaction.bind(provider),
      signAllTransactions: provider.signAllTransactions.bind(provider),
    };
  }, [provider, publicKey]);

  const value = useMemo<PhantomContextValue>(
    () => ({
      provider,
      ready: Boolean(provider?.isPhantom),
      connected,
      connecting,
      publicKey,
      wallet,
      connect: async () => {
        if (!provider) {
          throw new Error("Phantom is not installed.");
        }

        setConnecting(true);
        try {
          const response = await provider.connect();
          setPublicKey(response.publicKey);
          setConnected(true);
        } finally {
          setConnecting(false);
        }
      },
      disconnect: async () => {
        if (!provider) {
          return;
        }

        await provider.disconnect();
        setPublicKey(null);
        setConnected(false);
      },
    }),
    [provider, connected, connecting, publicKey, wallet]
  );

  return (
    <PhantomContext.Provider value={value}>{children}</PhantomContext.Provider>
  );
}

export function usePhantomWallet() {
  const context = useContext(PhantomContext);
  if (!context) {
    throw new Error("usePhantomWallet must be used inside PhantomWalletProvider.");
  }

  return context;
}

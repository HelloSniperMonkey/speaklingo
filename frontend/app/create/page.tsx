"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LobbyForm } from "@/components/LobbyForm";
import { firestore } from "@/lib/firebase";
import { collection, doc, setDoc } from "firebase/firestore";

export default function CreatePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create a new room document in Firestore and navigate to it
  const handleCreateRoom = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Create a new room document (just the document, not the WebRTC connection)
      const callDoc = doc(collection(firestore, "calls"));
      await setDoc(callDoc, {
        createdAt: new Date().toISOString(),
        status: "waiting"
      });

      // Navigate to the room page with a flag indicating we're the creator
      router.push(`/room/${callDoc.id}?role=creator`);
    } catch (err) {
      console.error("Failed to create room:", err);
      setError("Failed to create room. Please try again.");
      setIsLoading(false);
    }
  };

  // Navigate to join an existing room
  const handleJoinRoom = async (roomId: string) => {
    setIsLoading(true);
    setError(null);

    // Navigate to the room page with a flag indicating we're joining
    router.push(`/room/${roomId}?role=joiner`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <LobbyForm
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
        isLoading={isLoading}
        error={error}
      />
    </div>
  );
}

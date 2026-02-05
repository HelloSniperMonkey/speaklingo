"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { LobbyForm } from "@/components/LobbyForm";
import { firestore } from "@/lib/firebase";
import { collection, doc, setDoc } from "firebase/firestore";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useTranslation } from "../components/I18nProvider";

export default function CreatePage() {
  const router = useRouter();
  const params = useParams();
  const lang = params.lang as string;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

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
      router.push(`/${lang}/room/${callDoc.id}?role=creator`);
    } catch (err) {
      console.error("Failed to create room:", err);
      setError(t("lobby.failedToCreateRoom"));
      setIsLoading(false);
    }
  };

  // Navigate to join an existing room
  const handleJoinRoom = async (roomId: string) => {
    setIsLoading(true);
    setError(null);

    // Navigate to the room page with a flag indicating we're joining
    router.push(`/${lang}/room/${roomId}?role=joiner`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      {/* Language Switcher in top-right corner */}
      <div className="absolute top-4 right-4 z-10">
        <LanguageSwitcher />
      </div>

      <LobbyForm
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
        isLoading={isLoading}
        error={error}
        dictionary={{
          title: t("lobby.title"),
          subtitle: t("lobby.subtitle"),
          createNewRoom: t("lobby.createNewRoom"),
          creatingRoom: t("lobby.creatingRoom"),
          or: t("lobby.or"),
          enterRoomId: t("lobby.enterRoomId"),
          joinRoom: t("lobby.joinRoom"),
          joining: t("lobby.joining"),
          poweredBy: t("common.poweredBy"),
          features: {
            videoChat: t("lobby.features.videoChat"),
            speechToText: t("lobby.features.speechToText"),
            aiTranslation: t("lobby.features.aiTranslation"),
          }
        }}
      />
    </div>
  );
}

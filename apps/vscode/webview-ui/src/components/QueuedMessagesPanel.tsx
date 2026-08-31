import { useState } from "react";
import { IconTrash, IconArrowUp, IconPencil, IconCheck, IconX, IconBolt, IconPhoto, IconVideo, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatStore } from "@/stores";
import { bridge } from "@/services";
import { useT } from "@/i18n";
import { Content } from "@/lib/content";
import { useResolvedMediaSrc } from "@/lib/use-resolved-media-src";

import type { ContentPart } from "shared/legacy-sdk";

function QueueMediaChip({ src, label, video = false }: { src: string; label: string; video?: boolean }) {
  const resolvedSrc = useResolvedMediaSrc(src);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-0.5 text-[10px] leading-4 text-sky-500 select-none cursor-default">
          {video ? <IconVideo className="size-3" /> : <IconPhoto className="size-3" />}
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="bg-popover text-popover-foreground border border-border p-1">
        {resolvedSrc === undefined ? (
          <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
        ) : video ? (
          <video src={resolvedSrc} className="max-w-56 max-h-56 rounded" muted preload="metadata" />
        ) : (
          <img src={resolvedSrc} alt={label} className="max-w-56 max-h-56 rounded object-contain" />
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function QueueItem({ id, content, isStreaming, onEdit }: { id: string; content: string | ContentPart[]; isStreaming: boolean; onEdit: (id: string) => void }) {
  const removeFromQueue = useChatStore((s) => s.removeFromQueue);
  const moveQueueItemUp = useChatStore((s) => s.moveQueueItemUp);
  const isFirst = useChatStore((s) => s.queue[0]?.id === id);
  const t = useT();
  const text = Content.getText(content);
  const images = Content.getImages(content);
  const videos = Content.getVideos(content);

  const handleSteer = async () => {
    const result = await bridge.steerChat(content);
    if (result.ok) {
      removeFromQueue(id);
    }
  };

  return (
    <div className="group flex items-stretch px-3 py-1.5 hover:bg-muted/50 transition-colors">
      <div className="flex-1 min-w-0">
        {text && <p className="text-sm line-clamp-2 text-foreground">{text}</p>}
        {(images.length > 0 || videos.length > 0) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {images.map((src, i) => (
              <QueueMediaChip key={i} src={src} label={t("queue.imageN", { n: i + 1 })} />
            ))}
            {videos.map((src, i) => (
              <QueueMediaChip key={i} src={src} label={t("queue.videoN", { n: i + 1 })} video />
            ))}
          </div>
        )}
      </div>
      <div className="ml-2 flex items-center gap-1 self-center shrink-0 border-l border-border pl-2 opacity-70 group-hover:opacity-100 transition-opacity">
        {isStreaming && (
          <Button
            variant="ghost"
            className="h-8 px-2 gap-1 border-0! text-xs whitespace-nowrap text-amber-500 hover:text-amber-600"
            onClick={() => {
              void handleSteer();
            }}
            title={t("queue.insertNow")}
          >
            <IconBolt className="size-4" />
            {t("queue.steer")}
          </Button>
        )}
        <Button variant="ghost" size="icon" className="size-8 border-0!" title={t("queue.edit")} onClick={() => onEdit(id)}>
          <IconPencil className="size-4" />
        </Button>
        {!isFirst && (
          <Button variant="ghost" size="icon" className="size-8 border-0!" title={t("queue.moveUp")} onClick={() => moveQueueItemUp(id)}>
            <IconArrowUp className="size-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="size-8 border-0! text-muted-foreground hover:text-destructive" title={t("queue.delete")} onClick={() => removeFromQueue(id)}>
          <IconTrash className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function EditingItem({ id, initialContent, onDone }: { id: string; initialContent: string; onDone: () => void }) {
  const [text, setText] = useState(initialContent);
  const editQueueItem = useChatStore((s) => s.editQueueItem);

  const handleSave = () => {
    if (text.trim()) {
      editQueueItem(id, text);
    }
    onDone();
  };

  return (
    <div className="flex items-center gap-1 px-3 py-1.5">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") onDone();
        }}
        className="flex-1 min-w-0 text-sm bg-transparent border-b border-border outline-none py-1"
      />
      <Button variant="ghost" size="icon" className="size-7 border-0!" onClick={handleSave}>
        <IconCheck className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7 border-0!" onClick={onDone}>
        <IconX className="size-4" />
      </Button>
    </div>
  );
}

export function QueuedMessagesPanel() {
  const queue = useChatStore((s) => s.queue);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (queue.length === 0) return null;

  return (
    <div className="max-h-60 overflow-y-auto bg-card shrink">
      {queue.map((item) =>
        editingId === item.id ? (
          <EditingItem key={item.id} id={item.id} initialContent={Content.getText(item.content)} onDone={() => setEditingId(null)} />
        ) : (
          <QueueItem key={item.id} id={item.id} content={item.content} isStreaming={isStreaming} onEdit={setEditingId} />
        ),
      )}
    </div>
  );
}

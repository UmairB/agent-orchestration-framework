import type {
  Announcements,
  DndContextProps,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent
} from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useState
} from "react";
import { createPortal } from "react-dom";
import tunnel from "tunnel-rat";
import { Card } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const t = tunnel();

export type { DragEndEvent } from "@dnd-kit/core";

type KanbanItemProps = {
  id: string;
  name: string;
  column: string;
} & Record<string, unknown>;

type KanbanColumnProps = {
  id: string;
  name: string;
} & Record<string, unknown>;

interface KanbanContextProps<
  T extends KanbanItemProps = KanbanItemProps,
  C extends KanbanColumnProps = KanbanColumnProps
> {
  columns: C[];
  data: T[];
  activeCardId: string | null;
}

const KanbanContext = createContext<KanbanContextProps>({
  columns: [],
  data: [],
  activeCardId: null
});

export interface KanbanBoardProps {
  id: string;
  children: ReactNode;
  className?: string;
}

export function KanbanBoard({ id, children, className }: KanbanBoardProps) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div
      className={cn(
        "flex size-full min-h-40 flex-col overflow-hidden rounded-md border border-border bg-background text-xs shadow-sm ring-2 transition-all",
        isOver ? "ring-primary" : "ring-transparent",
        className
      )}
      ref={setNodeRef}
    >
      {children}
    </div>
  );
}

export type KanbanCardProps<T extends KanbanItemProps = KanbanItemProps> = T & {
  children?: ReactNode;
  className?: string;
};

export function KanbanCard<T extends KanbanItemProps = KanbanItemProps>({
  id,
  name,
  children,
  className
}: KanbanCardProps<T>) {
  const { attributes, listeners, setNodeRef, transition, transform, isDragging } = useSortable({ id });
  const { activeCardId } = useContext(KanbanContext) as KanbanContextProps;
  const style = {
    transition,
    transform: CSS.Transform.toString(transform)
  };

  return (
    <>
      <div style={style} {...listeners} {...attributes} ref={setNodeRef}>
        <Card
          className={cn(
            "cursor-grab gap-4 rounded-md p-3 shadow-sm",
            isDragging && "pointer-events-none cursor-grabbing opacity-30",
            className
          )}
        >
          {children ?? <p className="m-0 text-sm font-medium">{name}</p>}
        </Card>
      </div>
      {activeCardId === id ? (
        <t.In>
          <Card className={cn("cursor-grab gap-4 rounded-md p-3 shadow-sm ring-2 ring-primary", isDragging && "cursor-grabbing", className)}>
            {children ?? <p className="m-0 text-sm font-medium">{name}</p>}
          </Card>
        </t.In>
      ) : null}
    </>
  );
}

export type KanbanCardsProps<T extends KanbanItemProps = KanbanItemProps> = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "id"
> & {
  children: (item: T) => ReactNode;
  id: string;
};

export function KanbanCards<T extends KanbanItemProps = KanbanItemProps>({
  children,
  className,
  ...props
}: KanbanCardsProps<T>) {
  const { data } = useContext(KanbanContext) as KanbanContextProps<T>;
  const filteredData = data.filter((item) => item.column === props.id);
  const items = filteredData.map((item) => item.id);

  return (
    <ScrollArea className="min-h-0 overflow-hidden">
      <SortableContext items={items}>
        <div className={cn("flex flex-grow flex-col gap-2 p-2", className)} {...props}>
          {filteredData.map(children)}
        </div>
      </SortableContext>
      <ScrollBar orientation="vertical" />
    </ScrollArea>
  );
}

export type KanbanHeaderProps = HTMLAttributes<HTMLDivElement>;

export function KanbanHeader({ className, ...props }: KanbanHeaderProps) {
  return <div className={cn("m-0 border-b border-border p-3 text-sm font-semibold", className)} {...props} />;
}

export type KanbanProviderProps<
  T extends KanbanItemProps = KanbanItemProps,
  C extends KanbanColumnProps = KanbanColumnProps
> = Omit<DndContextProps, "children"> & {
  children: (column: C) => ReactNode;
  className?: string;
  columns: C[];
  data: T[];
  onDataChange?: (data: T[]) => void;
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
};

export function KanbanProvider<
  T extends KanbanItemProps = KanbanItemProps,
  C extends KanbanColumnProps = KanbanColumnProps
>({
  children,
  onDragStart,
  onDragEnd,
  onDragOver,
  className,
  columns,
  data,
  onDataChange,
  ...props
}: KanbanProviderProps<T, C>) {
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor)
  );

  function handleDragStart(event: DragStartEvent) {
    const card = data.find((item) => item.id === event.active.id);
    if (card) setActiveCardId(event.active.id as string);
    onDragStart?.(event);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeItem = data.find((item) => item.id === active.id);
    const overItem = data.find((item) => item.id === over.id);
    if (!activeItem) return;

    const activeColumn = activeItem.column;
    const overColumn = overItem?.column || columns.find((column) => column.id === over.id)?.id || columns[0]?.id;

    if (activeColumn !== overColumn) {
      let newData = [...data];
      const activeIndex = newData.findIndex((item) => item.id === active.id);
      const overIndex = newData.findIndex((item) => item.id === over.id);
      newData[activeIndex].column = overColumn;
      newData = arrayMove(newData, activeIndex, overIndex);
      onDataChange?.(newData);
    }

    onDragOver?.(event);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCardId(null);
    onDragEnd?.(event);

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = data.findIndex((item) => item.id === active.id);
    const newIndex = data.findIndex((item) => item.id === over.id);
    onDataChange?.(arrayMove([...data], oldIndex, newIndex));
  }

  const announcements: Announcements = {
    onDragStart({ active }) {
      const { name, column } = data.find((item) => item.id === active.id) ?? {};
      return `Picked up the card "${name}" from the "${column}" column`;
    },
    onDragOver({ active, over }) {
      const { name } = data.find((item) => item.id === active.id) ?? {};
      const newColumn = columns.find((column) => column.id === over?.id)?.name;
      return `Dragged the card "${name}" over the "${newColumn}" column`;
    },
    onDragEnd({ active, over }) {
      const { name } = data.find((item) => item.id === active.id) ?? {};
      const newColumn = columns.find((column) => column.id === over?.id)?.name;
      return `Dropped the card "${name}" into the "${newColumn}" column`;
    },
    onDragCancel({ active }) {
      const { name } = data.find((item) => item.id === active.id) ?? {};
      return `Cancelled dragging the card "${name}"`;
    }
  };

  return (
    <KanbanContext.Provider value={{ columns, data, activeCardId }}>
      <DndContext
        accessibility={{ announcements }}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        sensors={sensors}
        {...props}
      >
        <div className={cn("grid size-full auto-cols-[minmax(260px,1fr)] grid-flow-col gap-4 overflow-x-auto", className)}>
          {columns.map((column) => children(column))}
        </div>
        {typeof window !== "undefined" ? createPortal(<DragOverlay><t.Out /></DragOverlay>, document.body) : null}
      </DndContext>
    </KanbanContext.Provider>
  );
}

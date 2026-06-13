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
import { GripVertical } from "lucide-react";
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
        "flex size-full min-h-40 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background text-xs shadow-sm ring-2 transition-all",
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
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transition, transform, isDragging } = useSortable({ id });
  const { activeCardId } = useContext(KanbanContext) as KanbanContextProps;
  const style = {
    transition,
    transform: CSS.Transform.toString(transform)
  };

  return (
    <>
      <div className="w-full min-w-0 max-w-full" style={style} ref={setNodeRef}>
        <Card
          className={cn(
            "relative w-full min-w-0 max-w-full gap-4 rounded-md p-3 pl-8 shadow-sm",
            isDragging && "pointer-events-none cursor-grabbing opacity-30",
            className
          )}
        >
          <button
            type="button"
            ref={setActivatorNodeRef}
            className="absolute left-1.5 top-2 flex h-7 w-5 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Drag ${name}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
          {children ?? <p className="m-0 text-sm font-medium">{name}</p>}
        </Card>
      </div>
      {activeCardId === id ? (
        <t.In>
          <Card className={cn("relative w-full min-w-0 max-w-full gap-4 rounded-md p-3 pl-8 shadow-sm ring-2 ring-primary", isDragging && "cursor-grabbing", className)}>
            <span className="absolute left-1.5 top-2 flex h-7 w-5 items-center justify-center rounded text-muted-foreground">
              <GripVertical className="h-4 w-4" aria-hidden="true" />
            </span>
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
    <ScrollArea className="min-h-0 min-w-0 overflow-hidden">
      <SortableContext items={items}>
        <div className={cn("flex w-full min-w-0 flex-grow flex-col gap-2 overflow-x-hidden p-2", className)} {...props}>
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
        <div className={cn("size-full min-w-0 overflow-x-hidden overflow-y-hidden pb-2", className)}>
          <div
            className="grid h-full w-full min-w-0 gap-4"
            style={{
              gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`
            }}
          >
            {columns.map((column) => children(column))}
          </div>
        </div>
        {typeof window !== "undefined" ? createPortal(<DragOverlay><t.Out /></DragOverlay>, document.body) : null}
      </DndContext>
    </KanbanContext.Provider>
  );
}

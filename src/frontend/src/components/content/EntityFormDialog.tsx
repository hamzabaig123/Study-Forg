import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";

export interface EntityFormValues {
  name: string;
  description: string;
}

interface EntityFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  initialValues?: EntityFormValues;
  pending?: boolean;
  errorMessage?: string | null;
  onSubmit: (values: EntityFormValues) => void;
  /** Deterministic-test marker prefix, e.g. `class`. */
  marker: string;
}

const EMPTY: EntityFormValues = { name: "", description: "" };

/**
 * Reusable create/rename dialog for classes, subjects, chapters, and topics.
 * Owns its draft locally and only resets when the dialog opens for a new
 * target, so a failed save never wipes what the user typed.
 */
export function EntityFormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initialValues,
  pending = false,
  errorMessage,
  onSubmit,
  marker,
}: EntityFormDialogProps) {
  const [values, setValues] = useState<EntityFormValues>(
    initialValues ?? EMPTY,
  );

  useEffect(() => {
    if (open) {
      setValues(initialValues ?? EMPTY);
    }
  }, [open, initialValues]);

  const trimmedName = values.name.trim();
  const canSubmit = trimmedName.length > 0 && !pending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ name: trimmedName, description: values.description.trim() });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-ocid={`${marker}.dialog`} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={`${marker}-name`}>Name</Label>
            <Input
              id={`${marker}-name`}
              data-ocid={`${marker}.input`}
              value={values.name}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="e.g. Organic Chemistry"
              autoFocus
              maxLength={120}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${marker}-description`}>
              Description{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              id={`${marker}-description`}
              data-ocid={`${marker}.textarea`}
              value={values.description}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="What does this cover?"
              rows={3}
              maxLength={400}
            />
          </div>
          {errorMessage ? (
            <p
              data-ocid={`${marker}.error_state`}
              className="text-destructive text-sm"
            >
              {errorMessage}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              data-ocid={`${marker}.cancel_button`}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-ocid={`${marker}.submit_button`}
              disabled={!canSubmit}
            >
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

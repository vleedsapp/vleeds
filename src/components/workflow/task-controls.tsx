"use client";

import { CalendarClock, CalendarPlus, CircleCheck, CircleX } from "lucide-react";
import { useId, useState } from "react";
import { cancelTask, completeTask, rescheduleTask, scheduleTask } from "@/app/w/[workspaceId]/today/actions";
import { ConfigSheet } from "@/components/settings/config-sheet";
import { Alert, buttonClass, cx, Field, inputClass } from "@/components/ui/primitives";
import { TASK_KIND_LABEL } from "@/lib/contact-workflow/dispositions";
import { TASK_KINDS, type TaskKind } from "@/lib/contact-workflow/types";
import { useWorkflowSheet } from "./sheet-host";

/**
 * Follow-up task controls (P1-E7): schedule (one open task per contact),
 * reschedule, complete without a contact attempt, cancel. Times are typed in
 * the workspace time zone; the server converts and re-checks everything.
 */

export type TimeContext = { timezoneLabel: string; today: string };

const small = (extra?: string) => buttonClass("secondary", cx("min-h-11 sm:min-h-9", extra));

function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) => {
    setPending(true);
    setError(null);
    try {
      const r = await fn();
      if (r.ok) setDone(r.message);
      else setError(r.error);
    } catch {
      setError("That couldn't be saved. Try again.");
    } finally {
      setPending(false);
    }
  };
  return { pending, error, done, run };
}

function Done({ message }: { message: string }) {
  return (
    <div role="status">
      <Alert tone="info">{message}</Alert>
    </div>
  );
}

/** Schedule a contact's next action (only when the contact has no open task). */
export function ScheduleTaskButton({
  workspaceId,
  companyId,
  contacts,
  contactId,
  time,
  label = "Schedule follow-up",
  className,
}: {
  workspaceId: string;
  companyId: string;
  /** Contacts that can receive a task (not restricted, not left, with a phone, no open task). */
  contacts: { id: string; name: string }[];
  contactId?: string;
  time: TimeContext;
  label?: string;
  className?: string;
}) {
  const sheet = useWorkflowSheet();
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => sheet.open((close) => <ScheduleSheet workspaceId={workspaceId} companyId={companyId} contacts={contacts} contactId={contactId} time={time} onClose={close} />)}
        className={small(className)}
      >
        <CalendarPlus aria-hidden className="size-4" />
        {label}
      </button>
      {sheet.element}
    </>
  );
}

function ScheduleSheet({
  workspaceId,
  companyId,
  contacts,
  contactId,
  time,
  onClose,
}: {
  workspaceId: string;
  companyId: string;
  contacts: { id: string; name: string }[];
  contactId?: string;
  time: TimeContext;
  onClose: () => void;
}) {
  const id = useId();
  const [values, setValues] = useState({ contactId: contactId ?? contacts[0]?.id ?? "", kind: "follow_up" as TaskKind, date: "", time: "", note: "" });
  const { pending, error, done, run } = useAction();
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const dirty = !done && (values.date !== "" || values.time !== "" || values.note !== "");

  return (
    <ConfigSheet
      title="Schedule follow-up"
      description="Each contact has one next action. Times use the workspace time zone."
      icon={<CalendarPlus className="stroke-[1.75]" />}
      dirty={dirty}
      pending={pending}
      error={error}
      onClose={onClose}
      saveLabel={done ? "Done" : "Schedule"}
      hideCancel={!!done}
      onSave={() =>
        done
          ? onClose()
          : run(() => scheduleTask(workspaceId, { companyId, contactId: values.contactId, kind: values.kind, date: values.date, time: values.time, note: values.note || null }))
      }
    >
      {done ? (
        <Done message={done} />
      ) : contacts.length === 0 ? (
        <Alert>No contact at this company can receive a task: each is restricted, has left, has no phone number or already has an open task.</Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Contact" htmlFor={`${id}-contact`}>
            <select id={`${id}-contact`} value={values.contactId} onChange={set("contactId")} className={inputClass}>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Task" htmlFor={`${id}-kind`}>
            <select id={`${id}-kind`} value={values.kind} onChange={set("kind")} className={inputClass}>
              {TASK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {TASK_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <DateTimeFields id={id} date={values.date} time={values.time} onDate={set("date")} onTime={set("time")} ctx={time} />
          <Field label="Note" htmlFor={`${id}-note`} optional>
            <input id={`${id}-note`} value={values.note} onChange={set("note")} maxLength={1000} className={inputClass} />
          </Field>
        </div>
      )}
    </ConfigSheet>
  );
}

function DateTimeFields({
  id,
  date,
  time,
  onDate,
  onTime,
  ctx,
  word = "Due",
}: {
  id: string;
  date: string;
  time: string;
  onDate: (e: { target: { value: string } }) => void;
  onTime: (e: { target: { value: string } }) => void;
  ctx: TimeContext;
  word?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${word} date`} htmlFor={`${id}-date`}>
          <input id={`${id}-date`} type="date" required min={ctx.today} value={date} onChange={onDate} aria-describedby={`${id}-tz`} className={inputClass} />
        </Field>
        <Field label={`${word} time`} htmlFor={`${id}-time`}>
          <input id={`${id}-time`} type="time" required value={time} onChange={onTime} aria-describedby={`${id}-tz`} className={inputClass} />
        </Field>
      </div>
      <p id={`${id}-tz`} className="text-[12.5px] text-ink-subtle">
        Time zone: {ctx.timezoneLabel}
      </p>
    </div>
  );
}

export type TaskSummary = { id: string; kindLabel: string; contactName: string; dueLabel: string; date: string; time: string };

/** Reschedule / Complete / Cancel for one open task. `canReschedule` is false for blocked tasks (cancel stays available). */
export function TaskActions({
  workspaceId,
  task,
  time,
  canReschedule = true,
  canComplete = true,
}: {
  workspaceId: string;
  task: TaskSummary;
  time: TimeContext;
  canReschedule?: boolean;
  canComplete?: boolean;
}) {
  const sheet = useWorkflowSheet();
  const setSheet = (kind: "reschedule" | "complete" | "cancel") =>
    sheet.open((close) =>
      kind === "reschedule" ? (
        <RescheduleSheet workspaceId={workspaceId} task={task} time={time} onClose={close} />
      ) : (
        <CloseTaskSheet workspaceId={workspaceId} task={task} outcome={kind} onClose={close} />
      ),
    );
  const what = `${task.kindLabel.toLowerCase()} for ${task.contactName}`;
  return (
    <>
      {canReschedule ? (
        <button type="button" aria-haspopup="dialog" aria-label={`Reschedule ${what}`} onClick={() => setSheet("reschedule")} className={small()}>
          <CalendarClock aria-hidden className="size-4" />
          Reschedule
        </button>
      ) : null}
      {canComplete ? (
        <button type="button" aria-haspopup="dialog" aria-label={`Complete ${what}`} onClick={() => setSheet("complete")} className={small()}>
          <CircleCheck aria-hidden className="size-4" />
          Complete
        </button>
      ) : null}
      <button type="button" aria-haspopup="dialog" aria-label={`Cancel ${what}`} onClick={() => setSheet("cancel")} className={small()}>
        <CircleX aria-hidden className="size-4" />
        Cancel task
      </button>
      {sheet.element}
    </>
  );
}

function RescheduleSheet({ workspaceId, task, time, onClose }: { workspaceId: string; task: TaskSummary; time: TimeContext; onClose: () => void }) {
  const id = useId();
  const [values, setValues] = useState({ date: task.date, time: task.time });
  const { pending, error, done, run } = useAction();
  const dirty = !done && (values.date !== task.date || values.time !== task.time);
  return (
    <ConfigSheet
      title={`Reschedule ${task.kindLabel.toLowerCase()}`}
      description={`${task.contactName} · currently ${task.dueLabel}`}
      icon={<CalendarClock className="stroke-[1.75]" />}
      dirty={dirty}
      pending={pending}
      error={error}
      onClose={onClose}
      saveLabel={done ? "Done" : "Reschedule"}
      hideCancel={!!done}
      onSave={() => (done ? onClose() : run(() => rescheduleTask(workspaceId, { taskId: task.id, date: values.date, time: values.time })))}
    >
      {done ? (
        <Done message={done} />
      ) : (
        <DateTimeFields
          id={id}
          date={values.date}
          time={values.time}
          onDate={(e) => setValues((v) => ({ ...v, date: e.target.value }))}
          onTime={(e) => setValues((v) => ({ ...v, time: e.target.value }))}
          ctx={time}
          word="New"
        />
      )}
    </ConfigSheet>
  );
}

function CloseTaskSheet({ workspaceId, task, outcome, onClose }: { workspaceId: string; task: TaskSummary; outcome: "complete" | "cancel"; onClose: () => void }) {
  const { pending, error, done, run } = useAction();
  const complete = outcome === "complete";
  return (
    <ConfigSheet
      title={complete ? `Complete ${task.kindLabel.toLowerCase()}` : `Cancel ${task.kindLabel.toLowerCase()}`}
      description={`${task.contactName} · ${task.dueLabel}`}
      icon={complete ? <CircleCheck className="stroke-[1.75]" /> : <CircleX className="stroke-[1.75]" />}
      dirty={false}
      pending={pending}
      error={error}
      onClose={onClose}
      saveLabel={done ? "Done" : complete ? "Complete task" : "Cancel task"}
      cancelLabel="Keep task"
      hideCancel={!!done}
      onSave={() => (done ? onClose() : run(() => (complete ? completeTask : cancelTask)(workspaceId, { taskId: task.id })))}
    >
      {done ? (
        <Done message={done} />
      ) : (
        <p className="text-[14.5px] leading-6 text-ink">
          {complete
            ? "Mark this task as handled without logging a call (for example, it was handled elsewhere or is no longer needed). No contact attempt is recorded. To record a call, use Call instead."
            : "Cancel this task. It stays in the activity history as cancelled."}
        </p>
      )}
    </ConfigSheet>
  );
}

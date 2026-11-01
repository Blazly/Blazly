import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon.jsx";
import { agentTitle } from "./aiOrchestratorClient.js";
import { cancelSchedule, describeRepeat, formatScheduleTime, listSchedules } from "./schedulesClient.js";

const STATUS_LABEL = {
  scheduled: "Scheduled",
  running: "Running now",
  done: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function ScheduledView({ uid, project, refreshKey, onOpenChat, importedChatIds, onNewTask }) {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const refresh = useCallback(async () => {
    if (!uid) return;
    try {
      setJobs(await listSchedules(uid, project));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, [uid, project]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [refresh, refreshKey]);

  async function cancel(id) {
    setBusyId(id);
    try {
      await cancelSchedule(uid, id);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  const upcoming = (jobs || []).filter((j) => j.status === "scheduled" || j.status === "running");
  const history = (jobs || [])
    .flatMap((j) => (j.runs || []).map((run) => ({ job: j, run })))
    .sort((a, b) => new Date(b.run.finishedAt) - new Date(a.run.finishedAt));
  const ended = (jobs || []).filter((j) => j.status === "cancelled" || ((j.status === "done" || j.status === "failed") && !(j.runs || []).length));

  return (
    <div className="page">
      <header className="page-intro">
        <div className="page-intro-text">
          <h1>Scheduled</h1>
          <p className="subpage-lead">
            Tasks Blazly runs for <strong>{project}</strong> on a date or repeat, up to 30 days ahead. In AI mode, just say
            when: “Every Monday at 9am check my SERP rankings” or “On 12 Nov write a blog about…, then publish it”.
          </p>
        </div>
        <div className="page-intro-actions">
          <button type="button" className="btn btn-primary" onClick={onNewTask}>
            <Icon name="plus" size={16} />
            Schedule a task
          </button>
        </div>
      </header>

      {error ? <p className="integration-notice is-error">{error}</p> : null}

      {jobs === null ? (
        <p className="integration-muted">Loading scheduled tasks…</p>
      ) : !jobs.length ? (
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            <Icon name="clock" size={20} />
          </span>
          <p className="empty-title">Nothing scheduled in {project}</p>
          <p className="empty-text">Switch to AI mode and describe what to run and when.</p>
        </div>
      ) : (
        <div className="schedule-sections">
          <section>
            <h2 className="schedule-heading">Upcoming</h2>
            {upcoming.length ? (
              <ul className="schedule-list">
                {upcoming.map((job) => (
                  <li key={job.id} className="schedule-item">
                    <span className="schedule-when">
                      <span className="schedule-time">{formatScheduleTime(job.nextRunAt, job.timezone)}</span>
                      <span className="schedule-repeat">{describeRepeat(job)}</span>
                    </span>
                    <span className="schedule-body">
                      <span className="schedule-title">{job.title}</span>
                      <span className="schedule-steps">{job.steps.map((s) => agentTitle(s.agentId)).join(" → ")}</span>
                    </span>
                    <span className={`schedule-status is-${job.status}`}>{STATUS_LABEL[job.status]}</span>
                    {job.status === "scheduled" ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busyId === job.id}
                        onClick={() => cancel(job.id)}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="integration-muted">No upcoming runs.</p>
            )}
          </section>

          {history.length ? (
            <section>
              <h2 className="schedule-heading">Recent runs</h2>
              <ul className="schedule-list">
                {history.map(({ job, run }) => (
                  <li key={run.id} className="schedule-item">
                    <span className="schedule-when">
                      <span className="schedule-time">{formatScheduleTime(run.finishedAt, job.timezone)}</span>
                    </span>
                    <span className="schedule-body">
                      <span className="schedule-title">{job.title}</span>
                      {run.error ? <span className="schedule-error">{run.error}</span> : null}
                    </span>
                    <span className={`schedule-status is-${run.status}`}>{STATUS_LABEL[run.status]}</span>
                    {importedChatIds?.has(`run_${run.id}`) ? (
                      <button type="button" className="btn btn-secondary" onClick={() => onOpenChat(run.id)}>
                        Open
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {ended.length ? (
            <section>
              <h2 className="schedule-heading">Cancelled</h2>
              <ul className="schedule-list">
                {ended.map((job) => (
                  <li key={job.id} className="schedule-item is-muted">
                    <span className="schedule-when">
                      <span className="schedule-time">{formatScheduleTime(job.nextRunAt, job.timezone)}</span>
                    </span>
                    <span className="schedule-body">
                      <span className="schedule-title">{job.title}</span>
                    </span>
                    <span className={`schedule-status is-${job.status}`}>{STATUS_LABEL[job.status]}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

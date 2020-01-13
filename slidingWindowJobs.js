export class SlidingWindowJobs {
  static jobStatus = {
    INIT: 'INIT',
    RUNNING: 'RUNNING',
    SUCCESS: 'SUCCESS',
    FAIL: 'FAIL',
  };

  static status = {
    INIT: 'INIT',
    RUNNING: 'RUNNING',
    SUCCESS: 'SUCCESS',
    FAIL: 'FAIL',
    PAUSED: 'PAUSED',
    STOPPED: 'STOPPED',
  };

  constructor({
                jobs = [],
                windowSize = 5,
                retry = 2,
                onJobSucceed,
                onJobFail,
                onJobExecuted,
  }) {
    this.status = SlidingWindowJobs.status.INIT;
    this.jobs = jobs;
    this.onJobSucceed = onJobSucceed;
    this.onJobFail = onJobFail;
    this.onJobExecuted = onJobExecuted;
    this.reports = jobs.map((job, index) => ({
      job,
      index,
      status: SlidingWindowJobs.jobStatus.INIT,
      tried: 0,
    }));
    this.windowSize = windowSize;
    this.retry = retry;
    this._jobsPromise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  _curr = -1;

  _getNextChunkOfJobs() {
    return this.reports.slice(this._curr + 1, this._curr + 1 + this.windowSize).filter(job =>
      job.status === SlidingWindowJobs.jobStatus.INIT
      || (job.status === SlidingWindowJobs.jobStatus.FAIL && job.tried <= this.retry));
  }

  _updateCurr() {
    const restJobs = this.reports.slice(this._curr + 1);
    const firstUnFinishedJobIndex = restJobs.findIndex(job => job.status !== SlidingWindowJobs.jobStatus.SUCCESS);
    this._curr += firstUnFinishedJobIndex;
  }

  _beforeJobStart(jobIndex) {
    this.reports[jobIndex].status = SlidingWindowJobs.jobStatus.RUNNING;
  }

  _onJobSucceed(jobIndex, result) {
    this.reports[jobIndex].status = SlidingWindowJobs.jobStatus.SUCCESS;
    this.reports[jobIndex].result = result;
    if (this.onJobSucceed instanceof Function) {
      this.onJobSucceed(jobIndex, result);
    }
  }

  _onJobFail(jobIndex, error) {
    this.reports[jobIndex].status = SlidingWindowJobs.jobStatus.FAIL;
    this.reports[jobIndex].error = error;
    if (this.onJobFail instanceof Function) {
      this.onJobFail(jobIndex, error);
    }
  }

  _onJobExecuted(jobIndex) {
    this.reports[jobIndex].tried += 1;
    if (this.reports[jobIndex].tried > this.retry && this.reports[jobIndex].status === SlidingWindowJobs.jobStatus.FAIL) {
      this.status = SlidingWindowJobs.status.FAIL;
      this._reject({ message: 'job failed', failedJobIndex: jobIndex, reports: this.reports });
    } else if (jobIndex === this._curr + 1) {
      this._workLoop();
    }
    if (this.onJobExecuted instanceof Function) {
      this.onJobExecuted(jobIndex);
    }
  }

  _workLoop() {
    if (this.status !== SlidingWindowJobs.jobStatus.RUNNING) {
      return;
    }
    this._updateCurr();
    if (this._curr === this.jobs.length - 1) {
      this._resolve(this.reports.map(report => report.result));
    }
    const jobsToStart = this._getNextChunkOfJobs();
    jobsToStart.forEach(async (jobPack) => {
      const { job, index } = jobPack;
      try {
        this._beforeJobStart(index);
        const result = await job();
        this._onJobSucceed(index, result);
      } catch(err) {
        this._onJobFail(index, err);
      } finally {
        this._onJobExecuted(index);
      }
    });
  }

  start() {
    if (this.status === SlidingWindowJobs.status.INIT || this.status === SlidingWindowJobs.status.PAUSED) {
      this.status = SlidingWindowJobs.status.RUNNING;
      this._workLoop();
    } else if (this.status === SlidingWindowJobs.status.FAIL) {
      throw new Error('tried to start a failed task');
    } else if (this.status === SlidingWindowJobs.status.STOPPED) {
      throw new Error('tried to start a cancelled task');
    } else if (this.status === SlidingWindowJobs.status.SUCCESS) {
      throw new Error('tried to start a finished task');
    }
    return this._jobsPromise;
  }

  stop() {
    this.status = SlidingWindowJobs.status.STOPPED;
  }

  pause() {
    this.status = SlidingWindowJobs.status.PAUSED;
  }

  resume() {
    this.status = SlidingWindowJobs.status.RUNNING;
    this._workLoop();
  }
}

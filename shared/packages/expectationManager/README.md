# Documentation

The `ExpectationManager` is the main class of this package.

The `ExpectationManager` class is a stateful class which tracks the status of `Expectations` and `PackageContainerExpectations`, and communicates with **Workers** in order to work on them.

## Main classes

Upon startup, one (1) instance of each of these classes are spun up:

- `ExpectationManager`, the main class of this package.
  It is a stateful class that is responsible for interfacing with **Workers** and **Workforce**.
- The `ExpectationTracker`, a stateful class.
  Responsible for keeping track of all `Expectations` and `PackageContainerExpectations`.
- The `EvaluationScheduler`
  Responsible for triggering an _Evaluation_ in a timely manner.
- The `WorkInProgressTracker`
  Responsible for tracking jobs that are currently in progress by one of the **Workers**.

When an _Evaluation_ is triggered (by `EvaluationScheduler`), an instance of the `EvaluationRunner` is created. This instance is short-lived and is teared down after the _Evaluation_ is completed.

## Evaluation in a nutshell

_Evaluations_ are triggered continously (by `EvaluationScheduler`) every few seconds.
During an _Evaluation_ the following things happen:

1. **Update of incoming data**
   If there have been any incoming data (from **Package Manager**), such as _expectations_, _packageContainerExpectations_ or _restart/abort-commands_, update the `trackedExpectations` accordingly.
2. **Evaluate all TrackedExpectations**
   The TrackedExpectations all have a current state. An evaluation evaluated the state and possibly changes the state to another state.
   For example, if a TrackedExpectation is in a WAITING state, it might be moved to READY and then to WORKING.
   The Evaluations are done in 2 passes:

   1. The first pass evaluates TrackedExpectations that are in some certain states, in parallel.
   2. The first pass evaluates the rest of TrackedExpectations, in series.

3. **Evaluate all TrackedPackageContainers**
   1. Set up any Monitors for the TrackedPackageContainer.
   2. Run any cronjobs that are scheduled to run.

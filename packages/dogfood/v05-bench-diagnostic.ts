import { start } from '../core/src/index';
import { getCommandEntryAllocationCount, resetCommandCaptureForTests } from '../core/src/command-capture';
import { getDrawCallsiteTestCounts, resetDrawCallsiteForTests } from '../core/src/draw-callsite';

start({ captureEvery: 1, overlay: false });

(window as any).__CANVAS_SCAN_V05_BENCH_DIAGNOSTIC__ = {
  getCounters() {
    return {
      commandEntryAllocations: getCommandEntryAllocationCount(),
      stackAllocations: getDrawCallsiteTestCounts().stackAllocations,
    };
  },
  resetCounters() {
    resetCommandCaptureForTests();
    resetDrawCallsiteForTests();
  },
};

import { start } from '../core/src/index';
import { getCommandEntryAllocationCount } from '../core/src/command-capture';
import { isKilled } from '../core/src/wrap-context';

start({ captureEvery: 1, overlay: false });
(window as any).__CANVAS_SCAN_COMMAND_CAPTURE_TEST__ = { getAllocationCount: getCommandEntryAllocationCount, isKilled };

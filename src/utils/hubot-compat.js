/**
 * Compatibility shims for different Hubot versions
 * Ensures consistent API across versions
 */

/**
 * Shim for logger.warn() vs logger.warning() compatibility
 * Newer Hubot versions use warn(), older versions use warning()
 * This ensures both methods work regardless of Hubot version
 *
 * @param {Object} logger - The robot.logger instance to shim
 */
const shimWarnMethod = (logger) => {
  // If warn doesn't exist but warning does, alias warn to warning
  if (!logger.warn && logger.warning) {
    logger.warn = logger.warning;
  }
  // If warning doesn't exist but warn does, alias warning to warn
  if (!logger.warning && logger.warn) {
    logger.warning = logger.warn;
  }
};

/**
 * Apply all available logger compatibility shims
 * Call this once when initializing the robot
 *
 * @param {Object} logger - The robot.logger instance to shim
 */
const applyLoggerShims = (logger) => {
  shimWarnMethod(logger);
};

module.exports = {
  shimWarnMethod,
  applyLoggerShims
};

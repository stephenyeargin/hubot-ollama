const { shimWarnMethod, applyLoggerShims } = require('../src/utils/hubot-compat');

describe('hubot-compat', () => {
  describe('shimWarnMethod', () => {
    describe('when logger has warn but not warning', () => {
      it('aliases warning to warn', () => {
        const logger = {
          warn: jest.fn()
        };

        shimWarnMethod(logger);

        expect(logger.warning).toBeDefined();
        expect(logger.warning).toBe(logger.warn);

        // Verify both methods call the same function
        logger.warning('test message');
        expect(logger.warn).toHaveBeenCalledWith('test message');
      });
    });

    describe('when logger has warning but not warn', () => {
      it('aliases warn to warning', () => {
        const logger = {
          warning: jest.fn()
        };

        shimWarnMethod(logger);

        expect(logger.warn).toBeDefined();
        expect(logger.warn).toBe(logger.warning);

        // Verify both methods call the same function
        logger.warn('test message');
        expect(logger.warning).toHaveBeenCalledWith('test message');
      });
    });

    describe('when logger has both warn and warning', () => {
      it('does not override existing methods', () => {
        const warnFn = jest.fn();
        const warningFn = jest.fn();
        const logger = {
          warn: warnFn,
          warning: warningFn
        };

        shimWarnMethod(logger);

        // Both should remain unchanged
        expect(logger.warn).toBe(warnFn);
        expect(logger.warning).toBe(warningFn);
      });
    });

    describe('when logger has neither warn nor warning', () => {
      it('does not add any methods', () => {
        const logger = {};

        shimWarnMethod(logger);

        expect(logger.warn).toBeUndefined();
        expect(logger.warning).toBeUndefined();
      });
    });
  });

  describe('applyLoggerShims', () => {
    it('applies shimWarnMethod', () => {
      const logger = {
        warn: jest.fn()
      };

      applyLoggerShims(logger);

      expect(logger.warning).toBeDefined();
      expect(logger.warning).toBe(logger.warn);
    });

    it('handles complete logger object', () => {
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      };

      applyLoggerShims(logger);

      // warn should still work
      logger.warn('test');
      expect(logger.warn).toHaveBeenCalledWith('test');

      // warning should now be aliased
      expect(logger.warning).toBe(logger.warn);
    });
  });

  describe('backwards compatibility', () => {
    it('allows old code using warning() to work with new logger', () => {
      const logger = {
        warn: jest.fn()
      };

      shimWarnMethod(logger);

      // Old code that called warning()
      logger.warning('Old style warning');
      expect(logger.warn).toHaveBeenCalledWith('Old style warning');
    });

    it('allows new code using warn() to work with old logger', () => {
      const logger = {
        warning: jest.fn()
      };

      shimWarnMethod(logger);

      // New code that calls warn()
      logger.warn('New style warn');
      expect(logger.warning).toHaveBeenCalledWith('New style warn');
    });
  });

  describe('real-world usage patterns', () => {
    it('works with Pino-like logger (newer Hubot)', () => {
      // Simulate Pino logger which has warn()
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        fatal: jest.fn(),
        trace: jest.fn()
      };

      applyLoggerShims(logger);

      // Both should work and point to the same underlying function
      logger.warn('Warning message');
      logger.warning('Also warning message');

      // Since warning is aliased to warn, both calls go to the same function
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenNthCalledWith(1, 'Warning message');
      expect(logger.warn).toHaveBeenNthCalledWith(2, 'Also warning message');
    });

    it('works with old logger implementation (older Hubot)', () => {
      // Simulate older logger which has warning()
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warning: jest.fn(),
        error: jest.fn()
      };

      applyLoggerShims(logger);

      // Both should work and point to the same underlying function
      logger.warn('Warning message');
      logger.warning('Also warning message');

      // Since warn is aliased to warning, both calls go to the same function
      expect(logger.warning).toHaveBeenCalledTimes(2);
      expect(logger.warning).toHaveBeenNthCalledWith(1, 'Warning message');
      expect(logger.warning).toHaveBeenNthCalledWith(2, 'Also warning message');
    });
  });

  describe('idempotency', () => {
    it('can be called multiple times safely', () => {
      const logger = {
        warn: jest.fn()
      };

      applyLoggerShims(logger);
      const firstWarning = logger.warning;

      applyLoggerShims(logger);
      const secondWarning = logger.warning;

      // Should still reference the same function
      expect(secondWarning).toBe(firstWarning);
    });
  });
});

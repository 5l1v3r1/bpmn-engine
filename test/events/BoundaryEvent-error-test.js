'use strict';

const getPropertyValue = require('../../lib/getPropertyValue');
const Lab = require('lab');
const testHelpers = require('../helpers/testHelpers');
const factory = require('../helpers/factory');
const {Engine} = require('../..');
const {EventEmitter} = require('events');

const lab = exports.lab = Lab.script();
const {beforeEach, describe, it} = lab;
const {expect, fail} = Lab.assertions;

const moddleOptions = {
  camunda: require('camunda-bpmn-moddle/resources/camunda')
};

describe('Error BoundaryEvent', () => {

  describe('behaviour', () => {
    const source = `
    <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
      <process id="theProcess" isExecutable="true">
        <startEvent id="start" />
        <serviceTask id="service" camunda:expression="\${services.test}" />
        <boundaryEvent id="errorEvent" attachedToRef="service">
          <errorEventDefinition errorRef="Error_0w1hljb" camunda:errorCodeVariable="serviceError" camunda:errorMessageVariable="message" />
        </boundaryEvent>
        <endEvent id="end" />
        <sequenceFlow id="flow0" sourceRef="start" targetRef="service" />
        <sequenceFlow id="flow1" sourceRef="service" targetRef="end" />
        <sequenceFlow id="flow2" sourceRef="errorEvent" targetRef="end" />
      </process>
      <error id="Error_0w1hljb" name="ServiceError" errorCode="\${message}" />
    </definitions>`;

    let context;
    beforeEach((done) => {

      testHelpers.getContext(source, moddleOptions, (err, c) => {
        if (err) return done(err);
        context = c;
        context.environment.addService('test', (arg, next) => {
          next();
        });

        done();
      });
    });

    it('has property cancelActivity true', (done) => {
      const event = context.getChildActivityById('errorEvent');
      expect(event).to.include({
        cancelActivity: true
      });
      done();
    });

    it('loads event definitions on activate', (done) => {
      const event = context.getChildActivityById('errorEvent');
      const eventApi = event.activate();

      const boundEvents = eventApi.getEvents();
      expect(boundEvents).to.have.length(1);

      expect(boundEvents[0]).to.include({
        id: 'errorEvent',
        type: 'bpmn:ErrorEventDefinition',
        cancelActivity: true
      });

      done();
    });

    it('returns expected state on start', (done) => {
      const task = context.getChildActivityById('service');
      const event = context.getChildActivityById('errorEvent');

      event.on('start', (activityApi, executionContext) => {
        expect(activityApi.getApi(executionContext).getState()).to.equal({
          id: 'errorEvent',
          type: 'bpmn:BoundaryEvent',
          attachedToId: 'service',
          errorId: 'Error_0w1hljb',
          entered: true
        });
        done();
      });

      event.activate();
      task.run();
    });

    it('resolves error code expression on caught error', (done) => {
      context.environment.addService('test', (arg, next) => {
        next(new Error('FAIL'));
      });

      const task = context.getChildActivityById('service');
      const event = context.getChildActivityById('errorEvent');

      event.once('catch', (caughtError, activityApi) => {
        activityApi.stop();
        expect(caughtError.name, 'name').to.equal('ServiceError');
        expect(caughtError.message, 'message').to.equal('FAIL');
        expect(caughtError.errorCode, 'error code').to.equal('FAIL');
        done();
      });

      event.activate();
      task.run();
    });

    it('outputs errorCodeVariable on caught error', (done) => {
      context.environment.addService('test', (arg, next) => {
        next(new Error('FAIL'));
      });

      const task = context.getChildActivityById('service');
      const event = context.getChildActivityById('errorEvent');
      event.activate();

      event.once('end', (activity, executionContext) => {
        activity.stop();

        const output = executionContext.getOutput();
        expect(output.serviceError, 'errorCodeVariable').to.equal('FAIL');
        expect(output.message, 'errorMessageVariable').to.equal('FAIL');
        done();
      });

      task.run();
    });

    it('discards outbound when attachedTo completes', (done) => {
      const task = context.getChildActivityById('service');
      const event = context.getChildActivityById('errorEvent');
      task.activate();
      event.activate();

      event.outbound[0].once('discarded', () => {
        done();
      });

      task.run();
    });

    it('discards attachedTo if completed', (done) => {
      context.environment.addService('test', (arg, next) => {
        next(new Error('FAIL'));
      });

      const task = context.getChildActivityById('service');
      const event = context.getChildActivityById('errorEvent');
      task.activate();
      event.activate();

      task.outbound[0].once('discarded', () => {
        done();
      });

      task.inbound[0].take();
    });

    it('returns expected state when completed', (done) => {
      context.environment.addService('test', (arg, next) => {
        next(new Error('FAIL'));
      });

      const task = context.getChildActivityById('service');
      const event = context.getChildActivityById('errorEvent');
      task.activate();
      event.activate();

      event.once('end', (eventApi) => {
        const state = eventApi.getState();
        expect(state.entered).to.be.undefined();
        expect(state).to.include({
          taken: true
        });
        done();
      });

      task.inbound[0].take();
    });

    it('is discarded if other bound event completes', (done) => {
      const engine = new Engine({
        source: factory.resource('bound-error-and-timer.bpmn')
      });
      const listener = new EventEmitter();

      listener.on('end-errorEvent', ({id}) => {
        fail(`<${id}> should have been discarded`);
      });

      let leaveTimerCount = 0;
      listener.on('leave-timerEvent', ({id}) => {
        leaveTimerCount++;
        if (leaveTimerCount > 1) fail(`<${id}> should only leave once`);
      });

      let leaveErrorCount = 0;
      listener.on('leave-errorEvent', ({id}) => {
        leaveErrorCount++;
        if (leaveErrorCount > 1) fail(`<${id}> should only leave once`);
      });

      engine.on('end', () => {
        testHelpers.expectNoLingeringListenersOnEngine(engine);
        done();
      });

      engine.execute({
        listener,
        variables: {
          input: 2
        }
      });
    });
  });

  describe('engine', () => {
    const source = `
    <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
      <process id="theProcess" isExecutable="true">
        <startEvent id="start" />
        <serviceTask id="service" camunda:expression="\${services.test}" />
        <boundaryEvent id="errorEvent" attachedToRef="service">
          <errorEventDefinition errorRef="Error_0w1hljb" camunda:errorCodeVariable="serviceError" camunda:errorMessageVariable="message" />
        </boundaryEvent>
        <endEvent id="end" />
        <sequenceFlow id="flow0" sourceRef="start" targetRef="service" />
        <sequenceFlow id="flow1" sourceRef="service" targetRef="end" />
        <sequenceFlow id="flow2" sourceRef="errorEvent" targetRef="end" />
      </process>
      <error id="Error_0w1hljb" name="ServiceError" errorCode="\${message}" />
    </definitions>`;

    it('boundary event is discarded if task completes', (done) => {
      const engine = new Engine({
        source,
        moddleOptions
      });
      const listener = new EventEmitter();
      listener.once('end-errorEvent', (e) => {
        fail(`<${e.id}> should have been discarded`);
      });

      engine.execute({
        listener,
        services: {
          test: (arg, next) => {
            next();
          }
        }
      }, (err) => {
        if (err) return done(err);

        testHelpers.expectNoLingeringListenersOnEngine(engine);
        done();
      });
    });

    it('boundary event is discarded if task is canceled', (done) => {
      const engine = new Engine({
        source,
        moddleOptions
      });
      const listener = new EventEmitter();
      listener.once('start-service', (activityApi) => {
        activityApi.cancel();
      });
      listener.once('end-errorEvent', (activityApi) => {
        fail(`<${activityApi.id}> should have been discarded`);
      });

      engine.execute({
        listener,
        services: {
          test: (arg, next) => {
            next();
          }
        }
      }, (err) => {
        if (err) return done(err);

        testHelpers.expectNoLingeringListenersOnEngine(engine);
        done();
      });
    });

    it('task is discarded on error', (done) => {
      const engine = new Engine({
        source,
        moddleOptions
      });
      const listener = new EventEmitter();
      listener.once('end-service', (e) => {
        fail(`<${e.id}> should have been discarded`);
      });

      engine.execute({
        listener,
        services: {
          test: (arg, next) => {
            next(new Error('Boom'));
          }
        }
      }, (err) => {
        if (err) return done(err);

        testHelpers.expectNoLingeringListenersOnEngine(engine);
        done();
      });
    });
  });

  describe('attachedTo multiple inbound', () => {
    const source = `
    <?xml version="1.0" encoding="UTF-8"?>
    <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
      <process id="testProcess" isExecutable="true">
        <startEvent id="start" />
        <serviceTask id="task" name="Get" camunda:expression="\${services.get(variables.defaultTaken)}" camunda:resultVariable="taskOutput" />
        <boundaryEvent id="errorEvent" attachedToRef="task">
          <errorEventDefinition errorRef="Error_0w1hljb" camunda:errorCodeVariable="serviceError" camunda:errorMessageVariable="message" />
        </boundaryEvent>
        <exclusiveGateway id="decision" default="flow4">
          <extensionElements>
            <camunda:inputOutput>
              <camunda:outputParameter name="defaultTaken">\${true}</camunda:outputParameter>
            </camunda:inputOutput>
          </extensionElements>
        </exclusiveGateway>
        <endEvent id="end" />
        <sequenceFlow id="flow1" sourceRef="start" targetRef="task" />
        <sequenceFlow id="flow2" sourceRef="task" targetRef="decision" />
        <sequenceFlow id="flow3" sourceRef="errorEvent" targetRef="decision" />
        <sequenceFlow id="flow4" sourceRef="decision" targetRef="task" />
        <sequenceFlow id="flow5" sourceRef="decision" targetRef="end">
          <conditionExpression xsi:type="tFormalExpression">\${variables.defaultTaken}</conditionExpression>
        </sequenceFlow>
      </process>
      <error id="Error_0w1hljb" name="ServiceError" errorCode="\${message}" />
    </definitions>`;

    it('completes process if no error', (done) => {
      const engine = new Engine({
        source,
        moddleOptions
      });

      const listener = new EventEmitter();
      let startCount = 0;
      listener.on('start-task', (activity) => {
        startCount++;
        if (startCount > 2) {
          fail(`<${activity.id}> Too many starts`);
        }
      });
      let endEventCount = 0;
      listener.on('start-end', () => {
        endEventCount++;
      });

      engine.execute({
        listener,
        services: {
          get: (defaultTaken) => {
            return function(context, callback) {
              callback(null, `successfully executed ${defaultTaken === true ? 'twice' : 'once'}`);
            };
          }
        },
        variables: {
          api: 'http://example.com'
        }
      });
      engine.once('end', (execution) => {
        expect(startCount, 'task starts').to.equal(2);
        expect(endEventCount, 'end event').to.equal(1);
        expect(execution.getOutput()).to.equal({
          defaultTaken: true,
          taskOutput: ['successfully executed twice']
        });
        testHelpers.expectNoLingeringListenersOnEngine(engine);
        done();
      });
    });

    it('completes process if error is caught', (done) => {
      const engine = new Engine({
        source,
        moddleOptions
      });

      const listener = new EventEmitter();
      let startCount = 0;
      listener.on('start-task', (activity) => {
        startCount++;
        if (startCount > 2) {
          fail(`<${activity.id}> Too many starts`);
        }
      });
      let endEventCount = 0;
      listener.on('start-end', () => {
        endEventCount++;
      });

      engine.execute({
        listener,
        services: {
          get: (defaultTaken) => {
            return function(context, callback) {
              callback(new Error(`successfully caught ${defaultTaken === true ? 'twice' : 'once'}`));
            };
          }
        },
        variables: {
          api: 'http://example.com'
        }
      });
      engine.once('end', (execution) => {
        expect(startCount, 'task starts').to.equal(2);
        expect(endEventCount, 'end event').to.equal(1);
        expect(execution.getOutput()).to.equal({
          defaultTaken: true,
          serviceError: 'successfully caught twice',
          message: 'successfully caught twice'
        });
        testHelpers.expectNoLingeringListenersOnEngine(engine);
        done();
      });
    });

  });

  describe('getState()', () => {
    it('returns remaining entered and attachedTo', (done) => {
      const source = `
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
        <process id="interruptedProcess" isExecutable="true">
          <serviceTask id="service" camunda:expression="\${services.test}" />
          <boundaryEvent id="errorEvent" attachedToRef="service">
            <errorEventDefinition errorRef="Error_0w1hljb" camunda:errorCodeVariable="serviceError" camunda:errorMessageVariable="message" />
          </boundaryEvent>
          <endEvent id="end1" />
          <endEvent id="end2" />
          <sequenceFlow id="flow1" sourceRef="service" targetRef="end1" />
          <sequenceFlow id="flow2" sourceRef="errorEvent" targetRef="end2" />
        </process>
        <error id="Error_0w1hljb" name="ServiceError" errorCode="\${message}" />
      </definitions>`;

      const engine = new Engine({
        name: 'stopMe',
        source,
        moddleOptions
      });
      const listener = new EventEmitter();
      listener.once('start-service', () => {
        engine.stop();
      });
      testHelpers.testBoundError = (context, next) => {
        return next(new Error('FAILED'));
      };

      engine.execute({
        listener,
        services: {
          test: {
            module: './test/helpers/testHelpers',
            fnName: 'testBoundError'
          }
        }
      });

      engine.once('end', () => {
        const state = engine.getState();

        const serviceState = getPropertyValue(state, 'definitions[0].processes.interruptedProcess.children', []).find(({id}) => id === 'service');
        const eventState = getPropertyValue(state, 'definitions[0].processes.interruptedProcess.children', []).find(({id}) => id === 'errorEvent');

        expect(eventState.entered, 'entered bound error event').to.be.true();
        expect(eventState.attachedToId).to.equal('service');
        expect(eventState.errorId).to.equal('Error_0w1hljb');

        expect(serviceState.entered, 'entered service').to.be.true();

        testHelpers.expectNoLingeringListenersOnEngine(engine);

        done();
      });
    });
  });

  describe('resume()', () => {
    it('resumes if not entered yet', (done) => {
      const source = `
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
        <process id="interruptedProcess" isExecutable="true">
          <serviceTask id="service" camunda:expression="\${services.test}" />
          <boundaryEvent id="errorEvent" attachedToRef="service">
            <errorEventDefinition errorRef="Error_0w1hljb" camunda:errorCodeVariable="serviceError" camunda:errorMessageVariable="message" />
          </boundaryEvent>
          <endEvent id="end1" />
          <endEvent id="end2" />
          <sequenceFlow id="flow1" sourceRef="service" targetRef="end1" />
          <sequenceFlow id="flow2" sourceRef="errorEvent" targetRef="end2" />
        </process>
        <error id="Error_0w1hljb" name="ServiceError" errorCode="\${message}" />
      </definitions>`;

      const engine1 = new Engine({
        source,
        name: 'stopMe',
        moddleOptions
      });
      const listener = new EventEmitter();

      let state;
      listener.once('start-service', () => {
        state = engine1.getState();
        engine1.stop();
      });

      engine1.once('end', () => {
        testHelpers.expectNoLingeringListenersOnEngine(engine1);

        const resumedEngine = Engine.resume(state, {}, (err) => {
          if (err) return done(err);
        });
        resumedEngine.once('end', () => {
          testHelpers.expectNoLingeringListenersOnEngine(resumedEngine);
          done();
        });
      });

      testHelpers.testBoundError = (context, next) => {
        return next(new Error('RESUMEERR'));
      };

      engine1.execute({
        listener,
        services: {
          test: {
            module: './test/helpers/testHelpers',
            fnName: 'testBoundError'
          }
        }
      }, (err) => {
        if (err) return done(err);
      });
    });
  });
});

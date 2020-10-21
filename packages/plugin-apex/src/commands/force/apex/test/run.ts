/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { TestService } from '@salesforce/apex-node';
import {
  AsyncTestConfiguration,
  AsyncTestArrayConfiguration,
  SyncTestConfiguration,
  TestItem,
  TestResult
} from '@salesforce/apex-node/lib/src/tests/types';
import { Row, Table } from '@salesforce/apex-node/lib/src/utils';
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { buildDescription, logLevels } from '../../../../utils';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/plugin-apex', 'run');

export const TestLevel = [
  'RunLocalTests',
  'RunAllTestsInOrg',
  'RunSpecifiedTests'
];

export const resultFormat = ['human', 'tap', 'junit', 'json'];

export function buildTestItem(testNames: string): TestItem[] {
  const testNameArray = testNames.split(',');
  const tItems = testNameArray.map(item => {
    if (item.indexOf('.') > 0) {
      const splitItemData = item.split('.');
      return {
        className: splitItemData[0],
        testMethods: [splitItemData[1]]
      } as TestItem;
    }

    return { className: item } as TestItem;
  });
  return tItems;
}

export default class Run extends SfdxCommand {
  public static description = buildDescription(
    messages.getMessage('commandDescription'),
    messages.getMessage('longDescription')
  );

  public static longDescription = messages.getMessage('longDescription');
  public static examples = [
    `$ sfdx force:apex:test:run`,
    `$ sfdx force:apex:test:run -n "MyClassTest,MyOtherClassTest" -r human`,
    `$ sfdx force:apex:test:run -s "MySuite,MyOtherSuite" -c --json`,
    `$ sfdx force:apex:test:run -t "MyClassTest.testCoolFeature,MyClassTest.testAwesomeFeature,AnotherClassTest,namespace.TheirClassTest.testThis" -r human`,
    `$ sfdx force:apex:test:run -l RunLocalTests -d <path to outputdir> -u me@my.org`
  ];

  protected static supportsUsername = true;

  protected static flagsConfig = {
    json: flags.boolean({
      description: messages.getMessage('jsonDescription')
    }),
    loglevel: flags.enum({
      description: messages.getMessage('logLevelDescription'),
      longDescription: messages.getMessage('logLevelLongDescription'),
      default: 'warn',
      options: logLevels
    }),
    apiversion: flags.builtin(),
    codecoverage: flags.boolean({
      char: 'c',
      description: messages.getMessage('codeCoverageDescription')
    }),
    outputdir: flags.string({
      char: 'd',
      description: messages.getMessage('outputDirectoryDescription')
    }),
    testlevel: flags.enum({
      char: 'l',
      description: messages.getMessage('testLevelDescription'),
      options: TestLevel
    }),
    classnames: flags.string({
      char: 'n',
      description: messages.getMessage('classNamesDescription')
    }),
    resultformat: flags.enum({
      char: 'r',
      description: messages.getMessage('resultFormatLongDescription'),
      options: resultFormat,
      required: true
    }),
    suitenames: flags.string({
      char: 's',
      description: messages.getMessage('suiteNamesDescription')
    }),
    tests: flags.string({
      char: 't',
      description: messages.getMessage('testsDescription')
    }),
    wait: flags.string({
      char: 'w',
      description: messages.getMessage('waitDescription')
    }),
    synchronous: flags.boolean({
      char: 'y',
      description: messages.getMessage('synchronousDescription')
    }),
    verbose: flags.builtin({
      description: messages.getMessage('verboseDescription')
    }),
    detailedcoverage: flags.boolean({
      char: 'v',
      description: messages.getMessage('detailedCoverageDescription'),
      dependsOn: ['codecoverage']
    })
  };

  public async run(): Promise<AnyJson> {
    try {
      if (!this.org) {
        return Promise.reject(
          new Error(messages.getMessage('missing_auth_error'))
        );
      }
      const conn = this.org.getConnection();
      const testService = new TestService(conn);

      if (this.flags.synchronous) {
        const testOptions: SyncTestConfiguration = {
          tests: buildTestItem(this.flags.tests),
          testLevel: 'RunSpecifiedTests'
        };
        const resSync = await testService.runTestSynchronous(
          testOptions,
          this.flags.codecoverage
        );
        if (this.flags.resultformat === 'human') {
          this.ux.log(this.formatHuman(resSync, this.flags.detailedcoverage));
        }
        return resSync;
      }

      let payload: AsyncTestConfiguration | AsyncTestArrayConfiguration;
      const testLevel = this.flags.testlevel
        ? this.flags.testlevel
        : 'RunSpecifiedTests';

      if (this.flags.tests) {
        payload = {
          tests: buildTestItem(this.flags.tests),
          testLevel
        };
      } else {
        payload = {
          classNames: this.flags.classnames,
          suiteNames: this.flags.suitenames,
          testLevel
        };
      }

      const res = (await testService.runTestAsynchronous(
        payload,
        this.flags.codecoverage
      )) as TestResult;

      if (this.flags.resultformat === 'human') {
        this.ux.log(this.formatHuman(res, this.flags.detailedcoverage));
      }
      return res;
    } catch (e) {
      return Promise.reject(e);
    }
  }

  public formatHuman(
    testResult: TestResult,
    detailedCoverage: boolean
  ): string {
    const tb = new Table();
    // Summary Table
    const summary: { [key: string]: string | number | undefined } =
      testResult.summary;
    const summaryRowArray: Row[] = [];
    for (const prop in summary) {
      const row: Row = {
        name: messages.getMessage(prop),
        value: summary[prop] ? String(summary[prop]) : ''
      };
      summaryRowArray.push(row);
    }
    let tbResult = tb.createTable(
      summaryRowArray,
      [
        {
          key: 'name',
          label: messages.getMessage('name_col_header')
        },
        { key: 'value', label: messages.getMessage('value_col_header') }
      ],
      messages.getMessage('test_summary_header')
    );

    // Test Result Table
    if (!detailedCoverage) {
      const testRowArray: Row[] = [];
      testResult.tests.forEach(
        (elem: {
          fullName: string;
          outcome: string;
          message: string | null;
          runTime: number;
        }) => {
          testRowArray.push({
            name: elem.fullName,
            outcome: elem.outcome,
            msg: elem.message ? elem.message : '',
            runtime: `${elem.runTime}`
          });
        }
      );

      tbResult += '\n\n';
      tbResult += tb.createTable(
        testRowArray,
        [
          {
            key: 'name',
            label: messages.getMessage('test_name_col_header')
          },
          { key: 'outcome', label: messages.getMessage('outcome_col_header') },
          { key: 'msg', label: messages.getMessage('msg_col_header') },
          { key: 'runtime', label: messages.getMessage('runtime_col_header') }
        ],
        messages.getMessage('test_results_header')
      );
    }
    // Code coverage
    if (testResult.codecoverage) {
      if (detailedCoverage) {
        const testRowArray: Row[] = [];
        testResult.tests.forEach(
          (elem: {
            fullName: string;
            outcome: string;
            perClassCoverage?: {
              apexClassOrTriggerName: string;
              percentage: string;
            };
            message: string | null;
            runTime: number;
          }) => {
            testRowArray.push({
              name: elem.fullName,
              coveredClassName: elem.perClassCoverage
                ? elem.perClassCoverage.apexClassOrTriggerName
                : '',
              outcome: elem.outcome,
              coveredClassPercentage: elem.perClassCoverage
                ? elem.perClassCoverage.percentage
                : '',
              msg: elem.message ? elem.message : '',
              runtime: `${elem.runTime}`
            });
          }
        );

        tbResult += '\n\n';
        tbResult += tb.createTable(
          testRowArray,
          [
            {
              key: 'name',
              label: messages.getMessage('test_name_col_header')
            },
            {
              key: 'coveredClassName',
              label: messages.getMessage('class_tested_header')
            },
            {
              key: 'outcome',
              label: messages.getMessage('outcome_col_header')
            },
            {
              key: 'coveredClassPercentage',
              label: messages.getMessage('percent_col_header')
            },
            { key: 'msg', label: messages.getMessage('msg_col_header') },
            { key: 'runtime', label: messages.getMessage('runtime_col_header') }
          ],
          messages.getMessage('detailed_code_cov_header', [
            testResult.summary.testRunId
          ])
        );
      }
      const codeCovRowArray: Row[] = [];
      testResult.codecoverage.forEach(
        (elem: {
          name: string;
          percentage: string;
          uncoveredLines: number[];
        }) => {
          codeCovRowArray.push({
            name: elem.name,
            percent: elem.percentage,
            uncoveredLines: this.formatUncoveredLines(elem.uncoveredLines)
          });
        }
      );

      tbResult += '\n\n';
      tbResult += tb.createTable(
        codeCovRowArray,
        [
          {
            key: 'name',
            label: messages.getMessage('classes_col_header')
          },
          {
            key: 'percent',
            label: messages.getMessage('percent_col_header')
          },
          {
            key: 'uncoveredLines',
            label: messages.getMessage('uncovered_lines_col_header')
          }
        ],
        messages.getMessage('code_cov_header')
      );
    }
    return tbResult;
  }

  public formatUncoveredLines(uncoveredLines: number[]): string {
    const arrayLimit = 5;
    if (uncoveredLines.length === 0) {
      return '';
    }

    const limit =
      uncoveredLines.length > arrayLimit ? arrayLimit : uncoveredLines.length;
    let processedLines = uncoveredLines.slice(0, limit).join(',');
    if (uncoveredLines.length > arrayLimit) {
      processedLines += '...';
    }
    return processedLines;
  }
}
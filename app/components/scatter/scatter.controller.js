import d3 from 'd3';

import crossfilter from 'crossfilter';
import _ from 'lodash';
import Clipboard from 'clipboard';

import dp from 'common/services/datapackage/datapackage';

import introData from './intro.json!';
import aboutHTML from './intro.md!';

import ScatterChart from './scatter-chart';

const mime = dp.normalize.mime;

controller.$inject = ['$scope', 'dataService', '$log', '$timeout', 'growl'];
function controller($scope, dataService, $log, $timeout, growl) {
  const main = this;

  const cellTemplate = `
  <div class="ui-grid-cell-contents">
    <span ng-switch="COL_FIELD">
      <span ng-switch-when="NA">
        {{COL_FIELD}}
      </span>
      <span ng-switch-default>
        <a href ng-click="grid.appScope.main.pasteSymbols(COL_FIELD)">
          {{COL_FIELD}}
        </a>
      </span>
    </span>
  </div>`;

  // grid
  const columnDefs = [
    {name: 'feature'},
    {name: 'symbol', cellTemplate},
    {name: 'baseMean', displayName: 'Base Mean', type: 'number', cellFilter: 'number', enableFiltering: false},
    {name: 'log2FoldChange', displayName: 'Log2 Fold Change', type: 'number', cellFilter: 'number', enableFiltering: false},
    {name: 'pvalue', displayName: 'P-Value', type: 'number', cellFilter: 'number', enableFiltering: false},
    {name: 'padj', displayName: 'FDR', type: 'number', cellFilter: 'number', sort: {direction: 'asc'}, enableFiltering: false}
  ];

  const gridOptions = {
    columnDefs,
    enableFiltering: true,
    enableRowSelection: true,
    enableSelectAll: false,
    selectionRowHeaderWidth: 35,
    enableFullRowSelection: true,
    enableRowHeaderSelection: false,
    enableColumnResizing: true,
    rowHeight: 25,
    showGridFooter: false,
    multiSelect: false,
    enableColumnMenus: false,
    noUnselect: true,
    enableGridMenu: true,
    exporterMenuCsv: true,
    exporterMenuPdf: false,
    exporterCsvFilename: 'selection.csv',
    exporterMenuAllData: false
  };

  // chart
  const $chart = d3.select('#_scatter__chart');
  const colorScale = d3.scale.category10();

  const chart = new ScatterChart({
    width: parseInt($chart.style('width'), 10),
    height: 500,
    margin: {top: 10, right: 30, bottom: 30, left: 40},
    highlightColor: colorScale
  });

  chart.brush.on('brushend.select', () => {
    $scope.$apply(() => {
      updateList();
    });
  });

  // data
  const dataState = {};

  // clipboard
  const clipboard = new Clipboard('#clipboard-btn', {
    text: () => main.geneList.map(x => x.symbol).join(' ')
  });

  clipboard.on('error', () => {
    prompt('This browser does not suppport copying directly to clipboard.  Copy this text instead.', main.geneList.map(x => x.symbol).join(' ')); // eslint-disable-line no-alert
  });

  // setup intro
  const introOptions = {
    steps: [
      {
        element: '#charts',
        intro: aboutHTML,
        position: 'floating'
      },
      ...introData
    ],
    showStepNumbers: false,
    exitOnOverlayClick: true,
    exitOnEsc: true
  };

  const sliderOpts = {
    showTicksValues: true,
    showTicks: true,
    enforceStep: false
  };

  // debounced functions
  const _draw = _.debounce(() => {
    $chart.selectAll('svg').remove();

    $chart.datum(dataState.data)
      .call(chart);

    $chart.classed('dirty', false);
  }, 100);

  const _update = _.debounce(() => {
    chart
      .updatePoints();

    $chart.classed('dirty', false);
  }, 100);

  return Object.assign(main, {
    editorOptions: {
      data: main.dataPackage,
      enableOpen: false
    },
    gene: main.dataPackage.resources[0].data[0].gene,
    geneList: [],
    pcut: 0.1,
    fccut: 0,
    logpcut: -1,
    alpha: 0.8,
    plot: 'hex',
    selectedData: main.dataPackage.resources[0].data[0],
    upDown: [0, 0],
    colorScale,
    dataState,
    introOptions,
    dropped,
    gridOptions,
    draw,
    update,
    change,
    loadDataset,
    pasteSymbols: list => {
      addSymbols(list);
      update();
    },
    chart,
    $chart,
    updateList,
    fcAlphaSlider: {
      showTicksValues: false,
      showTicks: false,
      enforceStep: false,
      floor: 0,
      ceil: 1,
      step: 0.01,
      precision: 2,
      onEnd: update,
      translate: (value, sliderId, label) => {
        switch (label) {
          case 'model':
            return `Opacity: ${value}`;
          default:
            return value;
        }
      }
    },
    fcCutSlider: {
      ...sliderOpts,
      floor: 0,
      ceil: 5,
      step: 1,
      onEnd: update
    },
    fdrCutSlider: {
      ...sliderOpts,
      floor: -5,
      ceil: 0,
      step: 1,
      onEnd: () => {
        main.pcut = Math.pow(10, Number(main.logpcut));
        update();
      },
      translate: value => `1e${value}`
    },
    $onInit: () => {
      loadDataset(main.dataPackage.resources[0].data[0]);
    }
  });

  function loadDataset(set) {
    const resource = main.dataPackage.resources[1];
    resource.url = resource.path = `./data/${set.filename}`;
    resource.name = set.name;

    dataService.reloadResource(resource)
      .then(() => {
        main.gene = set.gene || set.symbols || '';
        main.change();
      });
  }

  function updateList() {
    if (chart.brush.empty()) {
      // console.log('clear');
      dataState.byBaseMean.filterRange([0.01, Infinity]);
      dataState.byLog2FoldChange.filterRange([-Infinity, Infinity]);

      main.gridOptions.data = dataState.byLog2FoldChange.top(Infinity);
    } else {
      const extent = chart.brush.extent();

      dataState.byBaseMean.filterRange([extent[0][0], extent[1][0]]);
      dataState.byLog2FoldChange.filterRange([extent[0][1], extent[1][1]]);

      main.gridOptions.data = dataState.byLog2FoldChange.top(Infinity);
    }
  }

  function setup() {
    const pcut = Math.pow(10, Number(main.logpcut));
    const fccut = main.fccut;

    const genesSearch = main.geneList.map(x => x.symbol);

    const geneCheck = function (d) {
      for (let i = 0; i < d.symbols.length; i++) {
        const j = genesSearch.indexOf(d.symbols[i]);
        if (j > -1) {
          return j;
        }
      }
      return -1;
    };

    const cutoffCheck = d => d.padj <= Number(pcut) && Math.abs(d.log2FoldChange) > fccut;

    const d = dataState.data.filter(cutoffCheck);

    main.upDown[0] = d.filter(d => d.log2FoldChange > 0).length;
    main.upDown[1] = d.length - main.upDown[0];

    chart
      .showScatter(main.plot === 'scatter')
      .showDensity(main.plot === 'hex')
      .highlightFilter(geneCheck)
      .alpha(main.alpha)
      .width(parseInt($chart.style('width'), 10))
      .cutoffFilter(cutoffCheck);
  }

  function update() {
    $log.debug('update');
    $chart.classed('dirty', true);
    setup();
    _update();
  }

  function change() {
    $log.debug('change');
    $chart.classed('dirty', true);
    $timeout(() => {
      processData();
      setup();
      draw();
    });
  }

  function draw() {
    $log.debug('draw');

    $chart.classed('dirty', true);

    setup();
    _draw();
  }

  function processData() {
    const resource = main.dataPackage.resources[1];

    const data = resource.data.filter(d => {
      d.pvalue = Number(d.pvalue) || Number(d.PValue);  // P-Value
      delete d.PValue;

      d.padj = Number(d.padj) || Number(d.FDR) || NaN;  // FDR
      delete d.FDR;

      d.baseMean = Number(d.baseMean) || Number(d.logCPM) || 0.001;  // Base Mean
      delete d.logCPM;

      d.log2FoldChange = Number(d.log2FoldChange) || Number(d.logFC) || 0;  // Log2 Fold Change
      delete d.logFC;

      d.symbols = d.symbol.split(';');
      d.symbol = d.symbol || d.feature;
      return d.baseMean > 0.001;
    });

    const ignoredKeys = [
      'pvalue',
      'padj',
      'baseMean',
      'log2FoldChange',
      'symbols',
      'symbol',
      'feature'
    ];

    if (data.length < 1) {
      growl.error(`Failed to find any features in ${resource.name}`);
      return;
    }

    // new data, new cross filter
    const cf = crossfilter(data);

    dataState.byBaseMean = cf.dimension(d => d.baseMean)
      .filterRange([0.01, Infinity]);

    dataState.byLog2FoldChange = cf.dimension(d => d.log2FoldChange)
      .filterRange([-Infinity, Infinity]);

    main.gridOptions.data = dataState.data = dataState.byBaseMean.top(Infinity);
    main.gridOptions.columnDefs = columnDefs.slice();

    Object.keys(dataState.data[0]).forEach(key => {
      if (!ignoredKeys.includes(key)) {
        main.gridOptions.columnDefs.push({name: key, visible: false});
      }
    });

    $log.info('getting unique symbols');

    const fullGeneList = [];

    data
      .forEach(x => {
        x.symbols.forEach(s => {
          fullGeneList.push(s);
        });
      });

    fullGeneList
      .sort();

    $log.info('done getting unique symbols', fullGeneList.length);

    const uniqGeneMap = {};
    const uniqGeneList = [];
    fullGeneList.forEach(symbol => {
      const item = uniqGeneMap[symbol];
      if (item) {
        item.count++;
      } else {
        uniqGeneMap[symbol] = {
          symbol,
          count: 1
        };
        uniqGeneList.push(uniqGeneMap[symbol]);
      }
    });

    main.uniqGeneMap = uniqGeneMap;
    main.uniqGeneList = uniqGeneList;

    main.geneList = [];
    addSymbols(main.gene);
  }

  function addSymbols(list) {
    list.split(/[\s;]/).forEach(symbol => {
      const item = main.uniqGeneMap[symbol];
      if (item && !main.geneList.includes(item)) {
        main.geneList.push(item);
      }
    });
  }

  function dropped(file) {
    $chart.classed('dirty', true);

    let mediatype = mime.lookup(file.name);

    //  todo: error on non txt, tsv, csv, json

    if (mediatype === 'text/plain') {
      mediatype = mime.lookup('tsv');
    }

    Object.assign(main.dataPackage.resources[1], {
      path: file.name || 'file',
      name: file.name || 'file',
      mediatype,
      content: file.content || '',
      active: true
    });

    dp.processResource(main.dataPackage.resources[1]);
    main.selectedData = null;
    main.gene = '';
    main.geneList = [];

    main.change();
  }
}

export default controller;

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import deepEqual from 'fast-deep-equal';
import { getOr, noop } from 'lodash/fp';
import { useCallback, useEffect, useRef, useState } from 'react';

import { MatrixHistogramQueryProps } from '../../components/matrix_histogram/types';
import { inputsModel } from '../../../common/store';
import { createFilter } from '../../../common/containers/helpers';
import { useKibana } from '../../../common/lib/kibana';
import {
  MatrixHistogramQuery,
  MatrixHistogramRequestOptions,
  MatrixHistogramStrategyResponse,
  MatrixHistogramData,
} from '../../../../common/search_strategy/security_solution';
import {
  AbortError,
  isErrorResponse,
  isCompleteResponse,
} from '../../../../../../../src/plugins/data/common';
import { getInspectResponse } from '../../../helpers';
import { InspectResponse } from '../../../types';
import * as i18n from './translations';

export interface UseMatrixHistogramArgs {
  data: MatrixHistogramData[];
  inspect: InspectResponse;
  refetch: inputsModel.Refetch;
  totalCount: number;
  buckets: Array<{
    key: string;
    doc_count: number;
  }>;
}

const ID = 'matrixHistogramQuery';

export const useMatrixHistogram = ({
  endDate,
  errorMessage,
  filterQuery,
  histogramType,
  indexNames,
  stackByField,
  startDate,
  threshold,
}: MatrixHistogramQueryProps): [boolean, UseMatrixHistogramArgs] => {
  const { data, notifications } = useKibana().services;
  const refetch = useRef<inputsModel.Refetch>(noop);
  const abortCtrl = useRef(new AbortController());
  const [loading, setLoading] = useState(false);
  const [matrixHistogramRequest, setMatrixHistogramRequest] = useState<
    MatrixHistogramRequestOptions
  >({
    defaultIndex: indexNames,
    factoryQueryType: MatrixHistogramQuery,
    filterQuery: createFilter(filterQuery),
    histogramType,
    id: ID,
    timerange: {
      interval: '12h',
      from: startDate,
      to: endDate,
    },
    stackByField,
    threshold,
  });

  const [matrixHistogramResponse, setMatrixHistogramResponse] = useState<UseMatrixHistogramArgs>({
    data: [],
    inspect: {
      dsl: [],
      response: [],
    },
    refetch: refetch.current,
    totalCount: -1,
    buckets: [],
  });

  const hostsSearch = useCallback(
    (request: MatrixHistogramRequestOptions) => {
      let didCancel = false;
      const asyncSearch = async () => {
        abortCtrl.current = new AbortController();
        setLoading(true);

        const searchSubscription$ = data.search
          .search<MatrixHistogramRequestOptions, MatrixHistogramStrategyResponse>(request, {
            strategy: 'securitySolutionSearchStrategy',
            abortSignal: abortCtrl.current.signal,
          })
          .subscribe({
            next: (response) => {
              if (isCompleteResponse(response)) {
                if (!didCancel) {
                  const histogramBuckets: Array<{
                    key: string;
                    doc_count: number;
                  }> = getOr([], 'rawResponse.aggregations.eventActionGroup.buckets', response);
                  setLoading(false);
                  setMatrixHistogramResponse((prevResponse) => ({
                    ...prevResponse,
                    data: response.matrixHistogramData,
                    inspect: getInspectResponse(response, prevResponse.inspect),
                    refetch: refetch.current,
                    totalCount: response.totalCount,
                    buckets: histogramBuckets,
                  }));
                }
                searchSubscription$.unsubscribe();
              } else if (isErrorResponse(response)) {
                if (!didCancel) {
                  setLoading(false);
                }
                // TODO: Make response error status clearer
                notifications.toasts.addWarning(i18n.ERROR_MATRIX_HISTOGRAM);
                searchSubscription$.unsubscribe();
              }
            },
            error: (msg) => {
              if (!(msg instanceof AbortError)) {
                notifications.toasts.addDanger({
                  title: errorMessage ?? i18n.FAIL_MATRIX_HISTOGRAM,
                  text: msg.message,
                });
              }
            },
          });
      };
      abortCtrl.current.abort();
      asyncSearch();
      refetch.current = asyncSearch;
      return () => {
        didCancel = true;
        abortCtrl.current.abort();
      };
    },
    [data.search, errorMessage, notifications.toasts]
  );

  useEffect(() => {
    setMatrixHistogramRequest((prevRequest) => {
      const myRequest = {
        ...prevRequest,
        defaultIndex: indexNames,
        filterQuery: createFilter(filterQuery),
        histogramType,
        timerange: {
          interval: '12h',
          from: startDate,
          to: endDate,
        },
        stackByField,
        threshold,
      };
      if (!deepEqual(prevRequest, myRequest)) {
        return myRequest;
      }
      return prevRequest;
    });
  }, [indexNames, endDate, filterQuery, startDate, stackByField, histogramType, threshold]);

  useEffect(() => {
    hostsSearch(matrixHistogramRequest);
  }, [matrixHistogramRequest, hostsSearch]);

  return [loading, matrixHistogramResponse];
};

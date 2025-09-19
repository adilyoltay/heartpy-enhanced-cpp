import inspect
import heartpy.peakdetection as pd

print(pd.__file__)
print('--- detect_peaks ---')
print(inspect.getsource(pd.detect_peaks))
print('--- fit_peaks ---')
print(inspect.getsource(pd.fit_peaks))
print('--- calc_rr ---')
print(inspect.getsource(pd.calc_rr))
print('--- calc_moving_average ---')
print(inspect.getsource(pd.calc_moving_average))
